import type { BridgeClient, TerminalBridge } from "./terminal-bridge.ts";
import type { WebSocketConnection } from "./websocket.ts";

type ClientMessage =
	| { type: "input"; data: string }
	| { type: "resize"; cols: number; rows: number }
	| { type: "release" };

export function parseClientMessage(text: string): ClientMessage | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const message = parsed as Record<string, unknown>;
	if (message.type === "input" && typeof message.data === "string") return { type: "input", data: message.data };
	if (message.type === "resize" && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
		return { type: "resize", cols: Number(message.cols), rows: Number(message.rows) };
	}
	if (message.type === "release") return { type: "release" };
	return undefined;
}

export function attachTerminalSocket(connection: WebSocketConnection, bridge: TerminalBridge): void {
	const client: BridgeClient = {
		output: (data) => connection.sendBinary(data),
		resize: (size, remoteControlled) => connection.sendText(JSON.stringify({ type: "size", ...size, remoteControlled })),
	};

	connection.onText((text) => {
		const message = parseClientMessage(text);
		if (!message) return;
		if (message.type === "input") bridge.input(message.data);
		else if (message.type === "resize") bridge.claimSize(client, message);
		else bridge.releaseSize(client);
	});

	const remove = bridge.addClient(client);
	connection.onClose(remove);
}
