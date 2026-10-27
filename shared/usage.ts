import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { formatTokens } from "./format.ts";
import { CACHE_GLYPH, INPUT, OUTPUT } from "./glyphs.ts";
import { readSubagentUsage } from "./subagent-usage.ts";

export type SessionEntries = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	cacheHitRate: number;
	entries: number;

	subagentCost: number;
}

export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, cacheHitRate: 0, entries: 0, subagentCost: 0 };
}

export function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
	if (!usage) return;

	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost?.total ?? 0;
}

export function computeUsage(entries: SessionEntries): UsageTotals {
	let latestCacheHitRate: number | undefined;
	const totals = emptyUsage();

	for (const entry of entries) {
		if (entry.type === "usage") {
			addUsage(totals, entry.usage);
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			addUsage(totals, entry.message.usage);
			const latestPromptTokens = entry.message.usage.input + entry.message.usage.cacheRead + entry.message.usage.cacheWrite;
			latestCacheHitRate = latestPromptTokens > 0 ? (entry.message.usage.cacheRead / latestPromptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}

	return {
		...totals,
		subagentCost: readSubagentUsage(entries).cost,
		cacheHitRate: latestCacheHitRate ?? 0
	};
}

export interface UsageTheme {
	fg(color: ThemeColor, text: string): string;
}

export function usageGroup(totals: UsageTotals, theme: UsageTheme): string {
	const parts: string[] = [];
	if (totals.input > 0) {
		parts.push(theme.fg("success", `${INPUT} `) + theme.fg("thinkingText", `${formatTokens(totals.input + totals.cacheWrite)}`));
	}
	if (totals.output > 0) {
		parts.push(theme.fg("accent", `${OUTPUT} `) + theme.fg("thinkingText", `${formatTokens(totals.output)}`));
	}
	const cacheTokens = totals.cacheRead + totals.cacheWrite;
	if (cacheTokens > 0) {
		parts.push(`${theme.fg("warning", CACHE_GLYPH)} ${theme.fg("thinkingText", `${totals.cacheHitRate.toFixed(2)}%`)}`);
	}
	return parts.join(" ");
}

export function usageCost(totals: UsageTotals, theme: UsageTheme, extraCost = 0): string {
	if (totals.cost <= 0 && extraCost <= 0) return "";
	const current = theme.fg("warning", `$${totals.cost.toFixed(3)}`);
	const extra = extraCost > 0 ? theme.fg("dim", ` ($${extraCost.toFixed(3)})`) : "";
	return `${current}${extra}`;
}
