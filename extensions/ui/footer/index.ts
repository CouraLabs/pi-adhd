import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
import { getFooterSections, subscribeFooterSections } from "../../../shared/footer-sections.ts";
import { isExtensionLoaded, markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { getAgentMode, subscribeAgentMode } from "../../../shared/modes.ts";
import { getRateLimits, subscribeRateLimits } from "../../../shared/rate-limits.ts";
import { getSubmode, subscribeSubmode } from "../../../shared/submodes.ts";
import { getTimers, subscribeTimers } from "../../../shared/timers.ts";
import { computeUsage, emptyUsage, type UsageTotals } from "../../../shared/usage.ts";
import { renderFooter } from "./render.ts";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("footer");
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;

	let usageCache: { key: string; value: UsageTotals } | undefined;

	let lastRealContextTokens: number | undefined;
	let unsubscribeMode: (() => void) | undefined;
	let unsubscribeSubmode: (() => void) | undefined;
	let unsubscribeSections: (() => void) | undefined;
	let unsubscribeTimers: (() => void) | undefined;
	let unsubscribeRateLimits: (() => void) | undefined;
	let timerTick: NodeJS.Timeout | undefined;

	const requestRender = () => tui?.requestRender();

	const syncTimerTick = () => {
		if (!tui) return;
		const active = getTimers().length > 0;
		if (active && !timerTick) {
			timerTick = setInterval(() => requestRender(), 1000);
			timerTick.unref?.();
		} else if (!active && timerTick) {
			clearInterval(timerTick);
			timerTick = undefined;
		}
	};

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

	const spawnCost = (): number => usageTotals().subagentCost;

	const contextUsageNow = (): ContextUsage | undefined => {
		const live = ctx?.getContextUsage();
		if (!live || live.tokens === null || live.percent === null) return live;
		if (lastRealContextTokens === undefined) return live;
		return {
			...live,
			tokens: lastRealContextTokens,
			percent: (lastRealContextTokens / live.contextWindow) * 100,
		};
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

							mode: isExtensionLoaded("modes") ? getAgentMode() : undefined,
							submode: isExtensionLoaded("submodes") ? getSubmode() : undefined,
							thinkingLevel: pi.getThinkingLevel(),
							contextUsage: contextUsageNow(),
							usage: usageTotals(),
							spawnCost: spawnCost(),
							timers: getTimers(),
							rateLimits: getRateLimits(),
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
		syncTimerTick();
	};

	pi.on("session_start", (_event, context) => {
		ctx = context;
		usageCache = undefined;
		lastRealContextTokens = undefined;

		unsubscribeMode?.();
		unsubscribeMode = subscribeAgentMode(() => requestRender());
		unsubscribeSubmode?.();
		unsubscribeSubmode = subscribeSubmode(() => requestRender());
		unsubscribeTimers?.();
		unsubscribeTimers = subscribeTimers(() => {
			syncTimerTick();
			requestRender();
		});
		unsubscribeRateLimits?.();
		unsubscribeRateLimits = subscribeRateLimits(() => requestRender());
		syncTimerTick();

		if (context.mode !== "tui") return;
		installFooter(context);
	});

	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("tool_execution_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_tree", () => {
		lastRealContextTokens = undefined;
		requestRender();
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const usage = event.message.usage;
		const totalTokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		if (event.message.stopReason !== "aborted" && event.message.stopReason !== "error" && totalTokens > 0) {
			lastRealContextTokens = totalTokens;
		}
		requestRender();
	});

	pi.on("session_shutdown", () => {
		unsubscribeMode?.();
		unsubscribeMode = undefined;
		unsubscribeSubmode?.();
		unsubscribeSubmode = undefined;
		unsubscribeSections?.();
		unsubscribeSections = undefined;
		unsubscribeTimers?.();
		unsubscribeTimers = undefined;
		unsubscribeRateLimits?.();
		unsubscribeRateLimits = undefined;
		if (timerTick) {
			clearInterval(timerTick);
			timerTick = undefined;
		}
		tui = undefined;
	});
}
