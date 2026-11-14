import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findExecutable } from "./find-executable.ts";

const execFileAsync = promisify(execFile);

const COMMON_PATHS = [
	"/Applications/Tailscale.app/Contents/MacOS/Tailscale",
	"/opt/homebrew/bin/tailscale",
	"/usr/local/bin/tailscale",
	"/usr/bin/tailscale",
	"C:\\Program Files\\Tailscale\\tailscale.exe",
];

export interface TailscaleNode {

	readonly ipv4: string;

	readonly dnsName: string | undefined;
}

export type TailscaleDetection = { ok: true; node: TailscaleNode } | { ok: false; reason: string };

interface TailscaleStatus {
	BackendState?: string;
	Self?: { TailscaleIPs?: string[]; DNSName?: string };
}

export function parseTailscaleStatus(json: string): TailscaleDetection {
	let status: TailscaleStatus;
	try {
		status = JSON.parse(json) as TailscaleStatus;
	} catch {
		return { ok: false, reason: "unreadable tailscale status" };
	}
	if (status.BackendState !== "Running") {
		return { ok: false, reason: `tailscale is ${status.BackendState ?? "not running"} (sign in to Tailscale to enable this link)` };
	}
	const ipv4 = status.Self?.TailscaleIPs?.find((ip) => ip.includes("."));
	if (!ipv4) return { ok: false, reason: "tailscale has no IPv4 address" };
	const dnsName = status.Self?.DNSName?.replace(/\.$/, "") || undefined;
	return { ok: true, node: { ipv4, dnsName } };
}

export async function detectTailscale(): Promise<TailscaleDetection> {
	const binary = findExecutable("tailscale", COMMON_PATHS);
	if (!binary) return { ok: false, reason: "Tailscale is not installed" };
	try {
		const { stdout } = await execFileAsync(binary, ["status", "--json"], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
		return parseTailscaleStatus(stdout);
	} catch (error) {
		return { ok: false, reason: `tailscale status failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
	}
}
