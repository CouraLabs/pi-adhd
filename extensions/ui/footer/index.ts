/**
 * footer — a richer, themed footer / status line for pi.
 *
 * Replaces the built-in footer with a single colorful stats line: the current
 * provider/model, thinking level, context-window gauge, and cumulative
 * token/cost usage. Statuses published by other extensions render on their own
 * line below, and any sections they register (see `shared/footer-sections.ts`)
 * render last of all. Toggle it with `/couralabs:toggle footer`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

/** Shape of `ctx.getContextUsage()`, as rendered by `renderFooter`. */
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
	/** Context tokens from the most recent valid assistant reply; undefined before the first one. */
	let lastRealContextTokens: number | undefined;
	let unsubscribeMode: (() => void) | undefined;
	let unsubscribeSubmode: (() => void) | undefined;
	let unsubscribeSections: (() => void) | undefined;
	let unsubscribeTimers: (() => void) | undefined;
	let unsubscribeRateLimits: (() => void) | undefined;
	let timerTick: NodeJS.Timeout | undefined;

	const requestRender = () => tui?.requestRender();

	/** Run a 1s render tick only while a countdown is active and the footer is mounted. */
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
	 * Read from the `subagent-usage` entries `computeUsage` sums (via
	 * `usageTotals().subagentCost`), so it survives a `/resume`: the entries live
	 * in the session file, where the live `SpawnService` does not. Each terminal
	 * run appends an entry, and appending advances the leaf, so the usage cache's
	 * session:leaf key recomputes the totals on the next frame.
	 */
	const spawnCost = (): number => usageTotals().subagentCost;

	/**
	 * Context gauge with the mid-turn jitter smoothed out.
	 *
	 * pi core alternates between two measurements for `getContextUsage()`: the
	 * last assistant's real token usage, and a chars/4 estimate for messages
	 * after it. The two disagree enough that the gauge visibly rises and falls
	 * within a single turn even though the real context only grows. Hold the
	 * last real reading while pi is in its estimate phase; pass through pi's
	 * "unknown after compaction" state (null tokens) untouched so the gauge
	 * shows ?/ until the next real reply re-anchors it.
	 */
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
							// The mode/submode segments render only when the extension that
							// owns their state is loaded — otherwise the shared stores would
							// still report a persisted value and the footer would show a mode
							// nothing is enforcing.
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

		// Re-render when /mode switches the agent mode or /plan / /grill the submode.
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

	// Keep the stats line fresh as usage and statuses change.
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("tool_execution_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
	pi.on("session_info_changed", () => requestRender());

	// A tree navigation rewrites the branch, so the held reading no longer
	// describes the visible context; fall back to pi's live value until the
	// next assistant reply re-anchors it.
	pi.on("session_tree", () => {
		lastRealContextTokens = undefined;
		requestRender();
	});

	// Mirror pi core's validity rule — aborted/errored replies and zero usage
	// don't count toward context, so they must not re-anchor the gauge either.
	// The event fires before the message is persisted, so reading
	// getContextUsage() here would still see the previous phase; take the
	// total straight from the message's own usage instead.
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
