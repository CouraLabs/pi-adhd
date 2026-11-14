import { StdoutSizeOverride, type TerminalSize } from "./size-override.ts";
import { stripTerminalReplies, TerminalModeTracker } from "./terminal-modes.ts";

export interface BridgeClient {

	output(data: Buffer): void;

	resize(size: TerminalSize, remoteControlled: boolean): void;
}

type StdoutWrite = typeof process.stdout.write;

function toBuffer(chunk: unknown, encoding: unknown): Buffer {
	if (typeof chunk === "string") return Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8");
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.alloc(0);
}

export class TerminalBridge {

	readonly #clients = new Set<BridgeClient>();

	readonly #modes = new TerminalModeTracker();

	readonly #size = new StdoutSizeOverride();

	#originalWrite: StdoutWrite | undefined;

	#patchedWrite: StdoutWrite | undefined;

	#pending: Buffer[] = [];

	#flushScheduled = false;

	#sizeOwner: BridgeClient | undefined;

	#requestRedraw: () => void = () => {};

	readonly #onResize = (): void => {
		const size = this.#size.size;
		for (const client of this.#clients) client.resize(size, this.#size.isOverridden);
	};

	get clientCount(): number {
		return this.#clients.size;
	}

	setRedrawHandler(handler: () => void): void {
		this.#requestRedraw = handler;
	}

	attach(): void {
		if (this.#originalWrite) return;
		const original = process.stdout.write;
		const observe = (chunk: unknown, encoding: unknown): void => this.#observe(chunk, encoding);
		const patched = function (this: NodeJS.WriteStream, ...args: unknown[]): boolean {
			try {
				observe(args[0], args[1]);
			} catch {}
			return (original as (...rest: unknown[]) => boolean).apply(this, args);
		} as StdoutWrite;
		this.#originalWrite = original;
		this.#patchedWrite = patched;
		process.stdout.write = patched;
		this.#size.install();
		process.stdout.on("resize", this.#onResize);
	}

	detach(): void {
		if (!this.#originalWrite) return;
		if (process.stdout.write === this.#patchedWrite) process.stdout.write = this.#originalWrite;
		this.#originalWrite = undefined;
		this.#patchedWrite = undefined;
		process.stdout.off("resize", this.#onResize);
		this.#sizeOwner = undefined;
		this.#size.uninstall();
		this.#clients.clear();
	}

	addClient(client: BridgeClient): () => void {
		this.#clients.add(client);
		client.resize(this.#size.size, this.#size.isOverridden);
		const prelude = this.#modes.prelude();
		if (prelude) client.output(Buffer.from(prelude, "utf8"));
		this.#requestRedraw();
		return () => this.#removeClient(client);
	}

	input(data: string): void {
		const cleaned = stripTerminalReplies(data);
		if (!cleaned) return;
		process.stdin.emit("data", process.stdin.readableEncoding ? cleaned : Buffer.from(cleaned, "utf8"));
	}

	claimSize(client: BridgeClient, size: TerminalSize): void {
		this.#sizeOwner = client;
		this.#size.set(size);
	}

	releaseSize(client: BridgeClient): void {
		if (this.#sizeOwner !== client) return;
		this.#sizeOwner = undefined;
		this.#size.clear();
	}

	#removeClient(client: BridgeClient): void {
		this.#clients.delete(client);
		this.releaseSize(client);
	}

	#observe(chunk: unknown, encoding: unknown): void {
		const data = toBuffer(chunk, encoding);
		if (data.length === 0) return;
		this.#modes.observe(data.toString("utf8"));
		if (this.#clients.size === 0) return;
		this.#pending.push(data);
		if (this.#flushScheduled) return;
		this.#flushScheduled = true;
		setImmediate(() => this.#flush());
	}

	#flush(): void {
		this.#flushScheduled = false;
		const data = Buffer.concat(this.#pending);
		this.#pending = [];
		for (const client of this.#clients) client.output(data);
	}
}
