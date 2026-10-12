/**
 * footer — a richer, themed footer / status line for pi.
 *
 * Replaces the built-in footer with a single colorful stats line: the current
 * provider/model, thinking level, context-window gauge, and cumulative
 * token/cost usage. Statuses published by other extensions render on their own
 * line below. Toggle it with `/couralabs-footer-ui [on|off]`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadSettings, updateSettings } from "../../shared/settings.ts";
import { computeUsage, emptyUsage, type UsageTotals } from "../../shared/usage.ts";
import { renderFooter } from "./render.ts";

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;

	let enabled = true;
	let usageCache: { key: string; value: UsageTotals } | undefined;

	const requestRender = () => tui?.requestRender();

	/** Recompute cumulative usage only when the session branch or model changes. */
	const usageTotals = (): UsageTotals => {
		const c = ctx;
		if (!c) return emptyUsage();
		const manager = c.sessionManager;
		const key = `${manager.getSessionId()}:${manager.getLeafId() ?? ""}:${c.model?.id ?? ""}`;
		if (usageCache?.key !== key) {
			usageCache = { key, value: computeUsage(manager.getEntries()) };
		}
		return usageCache.value;
	};

	const installFooter = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setFooter((footerTui, theme, footerData) => {
			tui = footerTui;
			return {
				invalidate() {},
				render: (width: number) =>
					renderFooter(
						{
							model: ctx?.model,
							thinkingLevel: pi.getThinkingLevel(),
							contextUsage: ctx?.getContextUsage(),
							usage: usageTotals(),
							statuses: footerData.getExtensionStatuses(),
						},
						width,
						theme,
					),
			};
		});
		requestRender();
	};

	const uninstallFooter = (context: ExtensionContext) => {
		context.ui.setFooter(undefined);
		tui = undefined;
	};

	pi.registerCommand("couralabs-footer-ui", {
		description: "Toggle the pi-pack footer (usage: /couralabs-footer-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			updateSettings({ footer: { enabled } });

			if (enabled) {
				installFooter(commandCtx);
				commandCtx.ui.notify("pi-pack footer enabled", "info");
			} else {
				uninstallFooter(commandCtx);
				commandCtx.ui.notify("Default footer restored", "info");
			}
		},
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		enabled = loadSettings().footer.enabled;
		usageCache = undefined;

		if (!enabled || context.mode !== "tui") return;
		installFooter(context);
	});

	// Keep the stats line fresh as usage and statuses change.
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("tool_execution_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		tui = undefined;
	});
}
