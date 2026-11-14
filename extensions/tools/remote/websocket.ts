import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const PING_INTERVAL_MS = 25_000;

const Opcode = {
	Continuation: 0x0,
	Text: 0x1,
	Binary: 0x2,
	Close: 0x8,
	Ping: 0x9,
	Pong: 0xa,
} as const;

export interface WebSocketConnection {

	sendText(text: string): void;

	sendBinary(data: Buffer): void;

	close(): void;

	onText(listener: (text: string) => void): void;

	onClose(listener: () => void): void;
}

interface ParsedFrame {
	fin: boolean;
	opcode: number;
	payload: Buffer;
	consumed: number;
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
	const length = payload.length;
	let header: Buffer;
	if (length < 126) {
		header = Buffer.from([0x80 | opcode, length]);
	} else if (length < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(length, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeBigUInt64BE(BigInt(length), 2);
	}
	return Buffer.concat([header, payload]);
}

export function parseFrame(buffer: Buffer): ParsedFrame | "incomplete" | "invalid" {
	if (buffer.length < 2) return "incomplete";
	const fin = (buffer[0]! & 0x80) !== 0;
	const opcode = buffer[0]! & 0x0f;
	const masked = (buffer[1]! & 0x80) !== 0;
	if (!masked) return "invalid";
	let length = buffer[1]! & 0x7f;
	let offset = 2;
	if (length === 126) {
		if (buffer.length < 4) return "incomplete";
		length = buffer.readUInt16BE(2);
		offset = 4;
	} else if (length === 127) {
		if (buffer.length < 10) return "incomplete";
		const big = buffer.readBigUInt64BE(2);
		if (big > BigInt(MAX_MESSAGE_BYTES)) return "invalid";
		length = Number(big);
		offset = 10;
	}
	if (length > MAX_MESSAGE_BYTES) return "invalid";
	if (buffer.length < offset + 4 + length) return "incomplete";
	const mask = buffer.subarray(offset, offset + 4);
	const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
	for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
	return { fin, opcode, payload, consumed: offset + 4 + length };
}

export function acceptKey(key: string): string {
	return createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64");
}

export function acceptWebSocket(request: IncomingMessage, socket: Duplex, head: Buffer): WebSocketConnection | undefined {
	const key = request.headers["sec-websocket-key"];
	if (typeof key !== "string" || request.headers.upgrade?.toLowerCase() !== "websocket") return undefined;

	socket.write(
		[
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${acceptKey(key)}`,
			"",
			"",
		].join("\r\n"),
	);

	const textListeners: ((text: string) => void)[] = [];
	const closeListeners: (() => void)[] = [];
	let pending = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
	let fragments: Buffer[] = [];
	let fragmentOpcode = 0;
	let closed = false;

	const finish = (): void => {
		if (closed) return;
		closed = true;
		clearInterval(pinger);
		socket.destroy();
		for (const listener of closeListeners) listener();
	};

	const send = (opcode: number, payload: Buffer): void => {
		if (closed || socket.destroyed) return;
		if (socket.writableLength > MAX_BUFFERED_BYTES) {
			finish();
			return;
		}
		socket.write(encodeFrame(opcode, payload));
	};

	const deliver = (opcode: number, payload: Buffer): void => {
		if (opcode !== Opcode.Text) return;
		const text = payload.toString("utf8");
		for (const listener of textListeners) listener(text);
	};

	const handleFrame = (frame: ParsedFrame): void => {
		switch (frame.opcode) {
			case Opcode.Ping:
				send(Opcode.Pong, frame.payload);
				return;
			case Opcode.Pong:
				return;
			case Opcode.Close:
				send(Opcode.Close, Buffer.alloc(0));
				finish();
				return;
			case Opcode.Continuation:
				fragments.push(frame.payload);
				break;
			default:
				fragmentOpcode = frame.opcode;
				fragments = [frame.payload];
		}
		if (!frame.fin) return;
		const message = Buffer.concat(fragments);
		fragments = [];
		if (message.length <= MAX_MESSAGE_BYTES) deliver(fragmentOpcode, message);
	};

	socket.on("data", (chunk: Buffer) => {
		pending = Buffer.concat([pending, chunk]);
		while (!closed) {
			const frame = parseFrame(pending);
			if (frame === "incomplete") return;
			if (frame === "invalid") {
				finish();
				return;
			}
			pending = pending.subarray(frame.consumed);
			handleFrame(frame);
		}
	});
	socket.on("close", finish);
	socket.on("error", finish);

	const pinger = setInterval(() => send(Opcode.Ping, Buffer.alloc(0)), PING_INTERVAL_MS);
	pinger.unref();

	return {
		sendText: (text) => send(Opcode.Text, Buffer.from(text, "utf8")),
		sendBinary: (data) => send(Opcode.Binary, data),
		close: () => {
			send(Opcode.Close, Buffer.alloc(0));
			finish();
		},
		onText: (listener) => textListeners.push(listener),
		onClose: (listener) => closeListeners.push(listener),
	};
}
