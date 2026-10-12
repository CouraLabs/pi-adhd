import type { Message, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { formatTokens } from "./format.ts";
import { CACHE_GLYPH, INPUT, OUTPUT } from "./glyphs.ts";

/** The session entries a branch exposes; used to walk usage records. */
export type SessionEntries = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;

/** Cumulative token and cost totals for a session. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
	if (!usage) return;
	// `usage.input` is fresh input only: pi-ai subtracts cache read/write from
	// providers that fold them into their prompt count (OpenAI, Google, Mistral)
	// and Anthropic/Bedrock report them as separate fields. Do not subtract
	// cache again here.
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost?.total ?? 0;
}

/** Walk a session branch and sum every usage record it contains. */
export function computeUsage(entries: SessionEntries): UsageTotals {
	const totals = emptyUsage();
	for (const entry of entries) {
		if (entry.type === "usage") {
			addUsage(totals, entry.usage);
		} else if (entry.type === "message") {
			const message = entry.message as Message;
			if (message.role === "assistant") addUsage(totals, message.usage);
			else if (message.role === "toolResult" && message.usage) addUsage(totals, message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

/** The theme slice the usage segments need. */
export interface UsageTheme {
	fg(color: ThemeColor, text: string): string;
}

/**
 * The usage group the footer and the subagent renderers share:
 * `↑ 120k ↓ 8.4k ⭍ 87%` — fresh input, output, and the cache-hit rate, joined
 * by spaces. Returns "" when there is nothing to show.
 *
 * `↑` counts fresh input only: pi-ai folds cache reads and writes into
 * `usage.input` for providers that report a single prompt count, so both are
 * subtracted back out. The cache-hit denominator is the whole prompt — fresh
 * input plus cache reads plus cache writes.
 */
export function usageGroup(totals: UsageTotals, theme: UsageTheme): string {
	const parts: string[] = [];
	if (totals.input > 0) {
		parts.push(theme.fg("success", `${INPUT} `) + theme.fg("thinkingText", `${formatTokens(Math.max(0, totals.input - totals.output) || totals.input)}`));
	}
	if (totals.output > 0) {
		parts.push(theme.fg("accent", `${OUTPUT} `) + theme.fg("thinkingText", `${formatTokens(totals.output)}`));
	}
	const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
	if (promptTokens > 0) {
		const cacheHit = (totals.cacheRead / promptTokens) * 100;
		parts.push(`${CACHE_GLYPH} ${cacheHit.toFixed(0)}%`);
	}
	return parts.join(" ");
}

/**
 * The cost segment, `$0.842`, with an optional parenthesised subagent total.
 * Returns "" when there is no cost to show.
 */
export function usageCost(totals: UsageTotals, theme: UsageTheme, extraCost = 0): string {
	if (totals.cost <= 0 && extraCost <= 0) return "";
	const current = theme.fg("warning", `$${totals.cost.toFixed(3)}`);
	const extra = extraCost > 0 ? theme.fg("dim", ` ($${extraCost.toFixed(3)})`) : "";
	return `${current}${extra}`;
}
