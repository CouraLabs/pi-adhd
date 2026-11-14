import { randomBytes } from "node:crypto";

export type TunnelKind = "cloudflare" | "tailscale";

export interface RemoteConfig {

	readonly port: number;

	readonly tunnels: ReadonlySet<TunnelKind>;

	readonly password: string;

	readonly passwordGenerated: boolean;
}

export const DEFAULT_REMOTE_PORT = 53520;

const ALL_TUNNELS: readonly TunnelKind[] = ["cloudflare", "tailscale"];

export function generatePassword(): string {
	return randomBytes(12).toString("base64url");
}

export function parsePort(raw: string | undefined): number {
	const value = Number.parseInt(raw ?? "", 10);
	return Number.isInteger(value) && value > 0 && value < 65536 ? value : DEFAULT_REMOTE_PORT;
}

export function parseTunnels(raw: string | undefined): ReadonlySet<TunnelKind> {
	if (raw === undefined || raw.trim() === "") return new Set(ALL_TUNNELS);
	const requested = raw
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter((part): part is TunnelKind => (ALL_TUNNELS as readonly string[]).includes(part));
	return new Set(requested);
}

export function readRemoteConfig(env: NodeJS.ProcessEnv, fallbackPassword: () => string): RemoteConfig {
	const configured = env.PI_ADHD_REMOTE_PASS?.trim();
	return {
		port: parsePort(env.PI_ADHD_REMOTE_PORT),
		tunnels: parseTunnels(env.PI_ADHD_REMOTE_TUNNEL),
		password: configured || fallbackPassword(),
		passwordGenerated: !configured,
	};
}
