import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { findExecutable } from "./find-executable.ts";

const RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const ASSETS: Readonly<Record<string, string>> = {
	"darwin-arm64": "cloudflared-darwin-arm64.tgz",
	"darwin-x64": "cloudflared-darwin-amd64.tgz",
	"linux-x64": "cloudflared-linux-amd64",
	"linux-arm64": "cloudflared-linux-arm64",
	"linux-arm": "cloudflared-linux-arm",
	"linux-ia32": "cloudflared-linux-386",
	"win32-x64": "cloudflared-windows-amd64.exe",
	"win32-ia32": "cloudflared-windows-386.exe",
};

const COMMON_PATHS = ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared"];

let installInFlight: Promise<string> | undefined;

export function cloudflaredAssetName(platform: string = process.platform, arch: string = process.arch): string | undefined {
	return ASSETS[`${platform}-${arch}`];
}

export function managedBinDir(): string {
	return join(dirname(getAgentDir()), "couralabs", "bin");
}

function managedBinaryPath(): string {
	return join(managedBinDir(), process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
}

function runsVersion(binary: string): boolean {
	return spawnSync(binary, ["--version"], { stdio: "ignore", timeout: 10_000 }).status === 0;
}

async function download(asset: string, destination: string): Promise<void> {
	const response = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: "follow" });
	if (!response.ok) throw new Error(`cloudflared download failed: HTTP ${response.status}`);
	const archive = `${destination}.download`;
	writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
	try {
		if (asset.endsWith(".tgz")) {
			const extracted = spawnSync("tar", ["-xzf", archive, "-C", dirname(destination)], { stdio: "ignore" });
			if (extracted.status !== 0) throw new Error("could not extract the cloudflared archive");
		} else {
			renameSync(archive, destination);
		}
	} finally {
		rmSync(archive, { force: true });
	}
	chmodSync(destination, 0o755);
}

async function install(): Promise<string> {
	const asset = cloudflaredAssetName();
	if (!asset) throw new Error(`no cloudflared build for ${process.platform}/${process.arch}`);
	const destination = managedBinaryPath();
	mkdirSync(dirname(destination), { recursive: true });
	await download(asset, destination);
	if (!runsVersion(destination)) throw new Error("downloaded cloudflared does not run");
	return destination;
}

export async function ensureCloudflared(): Promise<string> {
	const existing = findExecutable("cloudflared", COMMON_PATHS);
	if (existing) return existing;
	const managed = managedBinaryPath();
	if (existsSync(managed) && runsVersion(managed)) return managed;
	installInFlight ??= install().finally(() => {
		installInFlight = undefined;
	});
	return installInFlight;
}
