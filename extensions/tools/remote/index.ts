import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { readRemoteConfig } from "./config.ts";
import { formatRemoteSnapshot, type RemoteSnapshot } from "./link-status.ts";
import { remoteState } from "./state.ts";

const COMMAND = "couralabs:pi-remote";
const TUI_HANDLE_WIDGET = "pi-remote-tui-handle";

const SUBCOMMANDS: readonly AutocompleteItem[] = [
	{ value: "status", label: "status", description: "Show links and password (default)" },
	{ value: "start", label: "start", description: "Start the remote server and tunnels" },
	{ value: "stop", label: "stop", description: "Stop the remote server and tunnels" },
	{ value: "restart", label: "restart", description: "Restart with fresh tunnels" },
];

function notify(ctx: ExtensionContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(text, severity);
	else console.error(text);
}

function captureTui(ctx: ExtensionContext): void {
	const { service } = remoteState();
	ctx.ui.setWidget(TUI_HANDLE_WIDGET, (tui) => {
		service.setRedrawHandler(() => tui.requestRender(true));
		return { render: () => [], invalidate() {} };
	});
}

async function startRemote(ctx: ExtensionContext): Promise<void> {
	const { service, fallbackPassword } = remoteState();
	try {
		await service.start(readRemoteConfig(process.env, () => fallbackPassword));
	} catch (error) {
		notify(ctx, `pi remote failed to start: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

function announceWhenPublic(ctx: ExtensionContext): void {
	const { service } = remoteState();
	const unsubscribe = service.subscribe((snapshot: RemoteSnapshot) => {
		if (!snapshot.running) {
			unsubscribe();
			return;
		}
		if (snapshot.cloudflare.state === "starting" || snapshot.tailscale.state === "starting") return;
		unsubscribe();
		const link = [snapshot.cloudflare, snapshot.tailscale, snapshot.local].find((status) => status.state === "ready");
		if (link?.state === "ready") notify(ctx, `pi remote: ${link.url}  ·  /${COMMAND} for the password`);
	});
}

async function waitForTunnels(): Promise<RemoteSnapshot> {
	const { service } = remoteState();
	const settled = (snapshot: RemoteSnapshot): boolean =>
		!snapshot.running || (snapshot.cloudflare.state !== "starting" && snapshot.tailscale.state !== "starting");
	const current = service.snapshot();
	if (settled(current)) return current;
	return new Promise((resolve) => {
		const timer = setTimeout(() => finish(service.snapshot()), 15_000);
		const unsubscribe = service.subscribe((snapshot) => {
			if (settled(snapshot)) finish(snapshot);
		});
		const finish = (snapshot: RemoteSnapshot): void => {
			clearTimeout(timer);
			unsubscribe();
			resolve(snapshot);
		};
	});
}

async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { service } = remoteState();
	const action = args.trim().toLowerCase() || "status";

	if (action === "stop") {
		await service.stop();
		notify(ctx, "pi remote stopped.");
		return;
	}
	if (action === "restart") await service.stop();
	if (action !== "status" && action !== "start" && action !== "restart") {
		notify(ctx, `Usage: /${COMMAND} [status|start|stop|restart]`, "warning");
		return;
	}
	if (!service.running) {
		if (ctx.mode === "tui") captureTui(ctx);
		void startRemote(ctx);
		notify(ctx, "pi remote: starting tunnels…");
	}
	notify(ctx, formatRemoteSnapshot(await waitForTunnels()));
}

export default function remoteExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("remote");

	pi.registerCommand(COMMAND, {
		description: "Show the pi remote web links and password (status | start | stop | restart)",
		getArgumentCompletions: (prefix) => SUBCOMMANDS.filter((item) => item.value.startsWith(prefix.trim().toLowerCase())),
		handler: handleCommand,
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		captureTui(ctx);
		const { service } = remoteState();
		if (service.running) return;
		announceWhenPublic(ctx);
		void startRemote(ctx);
	});

	pi.on("session_shutdown", async (event) => {
		if (event.reason === "quit") await remoteState().service.stop();
	});
}
