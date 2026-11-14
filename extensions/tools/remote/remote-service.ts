import type { Server } from "node:http";
import type { RemoteConfig } from "./config.ts";
import { createRemoteHttpHandler, type RemoteHttpHandler } from "./http-server.ts";
import type { LinkStatus, RemoteSnapshot } from "./link-status.ts";
import { TerminalBridge } from "./terminal-bridge.ts";
import { startCloudflareTunnel, type CloudflareTunnel } from "./tunnels/cloudflare.ts";
import { detectTailscale } from "./tunnels/tailscale.ts";

const PORT_ATTEMPTS = 20;

type Listener = (snapshot: RemoteSnapshot) => void;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

export class RemoteService {

	readonly #bridge = new TerminalBridge();

	readonly #listeners = new Set<Listener>();

	#config: RemoteConfig | undefined;

	#http: RemoteHttpHandler | undefined;

	#servers: Server[] = [];

	#tunnel: CloudflareTunnel | undefined;

	#local: LinkStatus = { state: "disabled" };

	#tailscale: LinkStatus = { state: "disabled" };

	#cloudflare: LinkStatus = { state: "disabled" };

	#generation = 0;

	get running(): boolean {
		return this.#config !== undefined;
	}

	snapshot(): RemoteSnapshot {
		return {
			running: this.running,
			password: this.#config?.password ?? "",
			passwordGenerated: this.#config?.passwordGenerated ?? false,
			local: this.#local,
			tailscale: this.#tailscale,
			cloudflare: this.#cloudflare,
			clients: this.#bridge.clientCount,
		};
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	setRedrawHandler(handler: () => void): void {
		this.#bridge.setRedrawHandler(handler);
	}

	async start(config: RemoteConfig): Promise<void> {
		if (this.running) return;
		const generation = ++this.#generation;
		this.#config = config;
		this.#http = createRemoteHttpHandler(config.password, this.#bridge);
		this.#bridge.attach();
		this.#local = { state: "starting" };
		this.#tailscale = config.tunnels.has("tailscale") ? { state: "starting" } : { state: "disabled" };
		this.#cloudflare = config.tunnels.has("cloudflare") ? { state: "starting" } : { state: "disabled" };

		let port: number;
		try {
			port = await this.#listenLocal(config.port);
		} catch (error) {
			await this.stop();
			throw error;
		}
		this.#local = { state: "ready", url: `http://127.0.0.1:${port}` };
		this.#emit();

		const pending: Promise<void>[] = [];
		if (config.tunnels.has("tailscale")) pending.push(this.#startTailscale(port, generation));
		if (config.tunnels.has("cloudflare")) pending.push(this.#startCloudflare(port, generation));
		await Promise.all(pending);
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.#generation++;
		this.#tunnel?.stop();
		this.#tunnel = undefined;
		this.#http?.closeConnections();
		await Promise.all(this.#servers.map(closeServer));
		this.#servers = [];
		this.#http = undefined;
		this.#bridge.detach();
		this.#config = undefined;
		this.#local = { state: "disabled" };
		this.#tailscale = { state: "disabled" };
		this.#cloudflare = { state: "disabled" };
		this.#emit();
	}

	async #listenLocal(preferredPort: number): Promise<number> {
		const http = this.#http!;
		for (let offset = 0; offset < PORT_ATTEMPTS; offset++) {
			try {
				const server = await http.listen(preferredPort + offset, "127.0.0.1");
				this.#servers.push(server);
				return preferredPort + offset;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
			}
		}
		const server = await http.listen(0, "127.0.0.1");
		this.#servers.push(server);
		const address = server.address();
		return typeof address === "object" && address ? address.port : preferredPort;
	}

	async #startTailscale(port: number, generation: number): Promise<void> {
		const detection = await detectTailscale();
		if (generation !== this.#generation) return;
		if (!detection.ok) {
			this.#tailscale = { state: "unavailable", reason: detection.reason };
			this.#emit();
			return;
		}
		try {
			const server = await this.#http!.listen(port, detection.node.ipv4);
			if (generation !== this.#generation) {
				await closeServer(server);
				return;
			}
			this.#servers.push(server);
			const host = detection.node.dnsName ?? detection.node.ipv4;
			this.#http!.addTrustedHost(`${host}:${port}`);
			this.#http!.addTrustedHost(`${detection.node.ipv4}:${port}`);
			this.#tailscale = { state: "ready", url: `http://${host}:${port}` };
		} catch (error) {
			this.#tailscale = { state: "unavailable", reason: errorMessage(error) };
		}
		this.#emit();
	}

	async #startCloudflare(port: number, generation: number): Promise<void> {
		try {
			const tunnel = await startCloudflareTunnel(port, () => this.#onTunnelExit(generation));
			if (generation !== this.#generation) {
				tunnel.stop();
				return;
			}
			this.#tunnel = tunnel;
			this.#http!.addTrustedHost(new URL(tunnel.url).host);
			this.#cloudflare = { state: "ready", url: tunnel.url };
		} catch (error) {
			if (generation !== this.#generation) return;
			this.#cloudflare = { state: "unavailable", reason: errorMessage(error) };
		}
		this.#emit();
	}

	#onTunnelExit(generation: number): void {
		if (generation !== this.#generation || this.#cloudflare.state !== "ready") return;
		this.#tunnel = undefined;
		this.#cloudflare = { state: "unavailable", reason: "cloudflared exited — run /couralabs:pi-remote restart" };
		this.#emit();
	}

	#emit(): void {
		const snapshot = this.snapshot();
		for (const listener of this.#listeners) listener(snapshot);
	}
}
