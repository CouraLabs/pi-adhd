import { spawn, type ChildProcess } from "node:child_process";
import { ensureCloudflared } from "./cloudflared-binary.ts";

const QUICK_TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 60_000;
const LOG_TAIL_CHARS = 2000;

export interface CloudflareTunnel {

	readonly url: string;

	readonly child: ChildProcess;

	stop(): void;
}

export function extractQuickTunnelUrl(log: string): string | undefined {
	return QUICK_TUNNEL_URL.exec(log)?.[0];
}

export async function startCloudflareTunnel(port: number, onExit: () => void): Promise<CloudflareTunnel> {
	const binary = await ensureCloudflared();
	const child = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	const stop = (): void => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
	};
	const killOnExit = (): void => stop();
	process.once("exit", killOnExit);
	child.once("exit", () => {
		process.off("exit", killOnExit);
		onExit();
	});

	return new Promise((resolve, reject) => {
		let log = "";
		const timer = setTimeout(() => fail(new Error("timed out waiting for the trycloudflare.com URL")), START_TIMEOUT_MS);
		const fail = (error: Error): void => {
			clearTimeout(timer);
			stop();
			const tail = log.trim().slice(-LOG_TAIL_CHARS);
			reject(tail ? new Error(`${error.message}\n${tail}`) : error);
		};
		const onData = (chunk: Buffer): void => {
			if (log.length < 64_000) log += chunk.toString("utf8");
			const url = extractQuickTunnelUrl(log);
			if (!url) return;
			clearTimeout(timer);
			child.stdout?.off("data", onData);
			child.stderr?.off("data", onData);
			child.stdout?.resume();
			child.stderr?.resume();
			resolve({ url, child, stop });
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.once("error", (error) => fail(error));
		child.once("exit", (code) => fail(new Error(`cloudflared exited (code ${code})`)));
	});
}
