/**
 * footer — a richer, themed footer / status line for pi.
 *
 * Replaces the built-in footer with a single colorful stats line: the current
 * provider/model, thinking level, context-window gauge, and cumulative
 * token/cost usage. Statuses published by other extensions render on their own
 * line below, and any sections they register (see `shared/footer-sections.ts`)
 * render last of all. Toggle it with `/footer-ui [on|off]`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { getSpawnService, type SpawnServiceConsumer } from "../../shared/spawn-service.ts";
import { getFooterSections, subscribeFooterSections } from "../../shared/footer-sections.ts";
import { loadSettings, updateSettings } from "../../shared/settings.ts";
import { getAgentMode, subscribeAgentMode } from "../../shared/modes.ts";
import { getSubmode, subscribeSubmode } from "../../shared/submodes.ts";
import { computeUsage, emptyUsage, type UsageTotals } from "../../shared/usage.ts";
import { renderFooter } from "./render.ts";

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;

	let enabled = true;
	let usageCache: { key: string; value: UsageTotals } | undefined;
	let unsubscribeMode: (() => void) | undefined;
	let unsubscribeSubmode: (() => void) | undefined;
	let unsubscribeSections: (() => void) | undefined;

	const requestRender = () => tui?.requestRender();

	/** Recompute cumulative usage only when the session branch or model changes. */
	const usageTotals = (): UsageTotals => {
		const c = ctx;
		if (!c) return emptyUsage();
		const manager = c.sessionManager;
		const key = `${manager.getSessionId()}:${manager.getLeafId() ?? ""}:${c.model?.id ?? ""}`;
		if (usageCache?.key !== key) {
			usageCache = { key, value: computeUsage(manager.buildContextEntries()) };
		}
		return usageCache.value;
	};

	/**
	 * Cumulative cost of every spawned agent this session has run.
	 *
	 * Read live from the published SpawnService rather than cached: a child
	 * accrues cost between parent turns, and the service may be absent (spawn
	 * not installed, or published by a child session), in which case the footer
	 * shows only the session cost.
	 */
	const spawnCost = (): number => {
		const service = getSpawnService<SpawnServiceConsumer>();
		if (!service) return 0;
		return service.listAgents().reduce((sum, record) => sum + (record.lifetimeUsage?.cost ?? 0), 0);
	};

	const installFooter = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setFooter((footerTui, theme, footerData) => {
			tui = footerTui;
			return {
				invalidate() {},
				render: (width: number) => {
					const sections = getFooterSections().flatMap((section) =>
						section.render({
							width,
							height: footerTui.terminal.rows,
							mode: footerTui.mode,
							theme,
							requestRender,
						}),
					);
					return renderFooter(
						{
							model: ctx?.model,
							mode: getAgentMode(),
							submode: getSubmode(),
							thinkingLevel: pi.getThinkingLevel(),
							contextUsage: ctx?.getContextUsage(),
							usage: usageTotals(),
							spawnCost: spawnCost(),
							statuses: footerData.getExtensionStatuses(),
							sections,
						},
						width,
						theme,
					);
				},
			};
		});
		unsubscribeSections?.();
		unsubscribeSections = subscribeFooterSections(() => requestRender());
		requestRender();
	};

	const uninstallFooter = (context: ExtensionContext) => {
		context.ui.setFooter(undefined);
		unsubscribeSections?.();
		unsubscribeSections = undefined;
		tui = undefined;
	};

	pi.registerCommand("footer-ui", {
		description: "Toggle the pi-tdah footer (usage: /footer-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			updateSettings({ footer: { enabled } });

			if (enabled) {
				installFooter(commandCtx);
				commandCtx.ui.notify("pi-tdah footer enabled", "info");
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

		// Re-render when /mode switches the agent mode or /plan / /grill the submode.
		unsubscribeMode?.();
		unsubscribeMode = subscribeAgentMode(() => requestRender());
		unsubscribeSubmode?.();
		unsubscribeSubmode = subscribeSubmode(() => requestRender());

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
		unsubscribeMode?.();
		unsubscribeMode = undefined;
		unsubscribeSubmode?.();
		unsubscribeSubmode = undefined;
		unsubscribeSections?.();
		unsubscribeSections = undefined;
		tui = undefined;
	});
}
