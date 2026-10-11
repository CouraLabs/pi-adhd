/**
 * editor — a closed, field-style prompt editor for pi.
 *
 * Wraps the built-in editor in a box with a `❯` marker, moves the streaming
 * working indicator to the top-right of the box, and shows cumulative
 * token/cost usage at the far right of the bottom rule. The "Working" label is
 * replaced with a random short joke phrase chosen fresh on every turn.
 *
 * Toggle it at any time with `/couralabs-prompt-ui [on|off]`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { computeUsage, type UsageTotals } from "../../shared/usage.ts";
import { FieldEditor, type UsageProvider } from "./field-editor.ts";
import { JOKES } from "./jokes.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let currentEditor: FieldEditor | undefined;
	let enabled = true;
	let lastJoke = -1;
	let usageCache: { key: string; value: UsageTotals } | undefined;

	const requestRender = () => tui?.requestRender();

	const usageProvider: UsageProvider = () => {
		const c = ctx;
		if (!c) return undefined;
		const manager = c.sessionManager;
		const key = `${manager.getSessionId()}:${manager.getLeafId() ?? ""}:${c.model?.id ?? ""}`;
		if (usageCache?.key !== key) {
			usageCache = { key, value: computeUsage(manager.getEntries()) };
		}
		return { totals: usageCache.value, theme: c.ui.theme };
	};

	/** Install the dot spinner, colored to match the editor's thinking-level border. */
	const applyWorkingIndicator = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		const color = currentEditor?.borderColor ?? context.ui.theme.getThinkingBorderColor(pi.getThinkingLevel());
		context.ui.setWorkingIndicator({
			frames: SPINNER_FRAMES.map((frame) => color(frame)),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	};

	const pickJoke = (): string => {
		if (JOKES.length === 0) return "Working";
		let index = Math.floor(Math.random() * JOKES.length);
		if (JOKES.length > 1 && index === lastJoke) index = (index + 1) % JOKES.length;
		lastJoke = index;
		return JOKES[index] ?? "Working";
	};

	const installEditor = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setEditorComponent((editorTui, theme, keybindings) => {
			tui = editorTui;
			currentEditor = new FieldEditor(editorTui, theme, keybindings, usageProvider);
			return currentEditor;
		});
		applyWorkingIndicator(context);
	};

	const uninstallEditor = (context: ExtensionContext) => {
		context.ui.setEditorComponent(undefined);
		context.ui.setWorkingIndicator();
		currentEditor = undefined;
		tui = undefined;
	};

	pi.registerCommand("couralabs-prompt-ui", {
		description: "Toggle the pi-pack prompt field (usage: /couralabs-prompt-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			if (enabled) {
				installEditor(commandCtx);
				commandCtx.ui.notify("pi-pack prompt field enabled", "info");
			} else {
				uninstallEditor(commandCtx);
				commandCtx.ui.notify("Default editor restored", "info");
			}
		},
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		usageCache = undefined;
		if (!enabled) return;
		installEditor(context);
	});

	// Swap in a new joke phrase for every turn and refresh the spinner colors.
	pi.on("turn_start", () => {
		if (!enabled || !ctx || ctx.mode !== "tui") return;
		ctx.ui.setWorkingMessage(pickJoke());
		applyWorkingIndicator(ctx);
	});

	// Keep the usage segment fresh when tokens or the model change.
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("model_select", () => {
		usageCache = undefined;
		requestRender();
	});
	pi.on("thinking_level_select", () => {
		if (enabled && ctx) applyWorkingIndicator(ctx);
	});
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		ctx = undefined;
		tui = undefined;
		currentEditor = undefined;
	});
}
