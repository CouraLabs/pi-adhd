/**
 * Pure rendering for the pi-pack footer: a single stats line with the model,
 * thinking level, context gauge, and cumulative token/cost usage, followed by
 * extension statuses on their own line.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../../shared/format.ts";
import { CACHE_GLYPH, CONTEXT_EMPTY, CONTEXT_FILLED, ELLIPSIS, INPUT, OUTPUT, SEPARATOR, THINKING_LEVELS } from "../../shared/glyphs.ts";
import type { UsageTotals } from "../../shared/usage.ts";

type ModelInfo = NonNullable<ExtensionContext["model"]>;
type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** Everything the footer needs to draw one frame. */
export interface FooterState {
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	contextUsage: ContextUsage | undefined;
	usage: UsageTotals;
	statuses: ReadonlyMap<string, string>;
}

/** A gauge whose color follows the usage percentage along a teal→red gradient from the active theme. */
function contextBar(theme: Theme, percent: number, cells = 8): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * cells);
	const color = mixColors(theme.colors.success, theme.colors.error, clamped / 100);
	return theme.style(CONTEXT_FILLED.repeat(filled), { fg: color }) + theme.fg("dim", CONTEXT_EMPTY.repeat(cells - filled));
}

/** Color context text along the same teal→red gradient as the gauge. */
function contextColor(theme: Theme, percent: number, text: string): string {
	const amount = Math.max(0, Math.min(1, percent / 100));
	return theme.style(text, { fg: mixColors(theme.colors.success, theme.colors.error, amount) });
}

function sanitizeStatus(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function joinSegments(parts: string[], theme: Theme): string {
	return parts.filter((part) => part.length > 0).join(theme.fg("dim", SEPARATOR));
}

export function renderFooter(state: FooterState, width: number, theme: Theme): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];

	// ── One line: model, thinking, context, and cumulative usage ──
	const parts: string[] = [];
	if (state.model) {
		parts.push(theme.fg("accent", `${state.model.provider}/${state.model.id}`));
		if (state.model.reasoning) {
			const level = state.thinkingLevel;
			const glyph = THINKING_LEVELS[level];
			parts.push(theme.getThinkingBorderColor(level)(glyph ? `${glyph} ${level}` : level));
		}
	}

	const contextUsage = state.contextUsage;
	const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow;
	if (contextUsage && contextUsage.percent !== null && contextWindow) {
		const percent = contextUsage.percent;
		const consumed = contextUsage.tokens ?? Math.round((percent / 100) * contextWindow);
		const label = `${formatTokens(consumed)}/${formatTokens(contextWindow)} (${Math.round(percent)}%)`;
		parts.push(`${contextBar(theme, percent)} ${contextColor(theme, percent, label)}`);
	} else if (contextWindow) {
		parts.push(theme.fg("dim", `ctx ?/${formatTokens(contextWindow)}`));
	}

	const totals = state.usage;
	if (totals.input > 0) parts.push(theme.fg("success", `${INPUT}${formatTokens(totals.input)}`));
	if (totals.output > 0) parts.push(theme.fg("accent", `${OUTPUT}${formatTokens(totals.output)}`));
	const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
	if (promptTokens > 0) {
		const cacheHit = (totals.cacheRead / promptTokens) * 100;
		parts.push(`${CACHE_GLYPH} ${cacheHit.toFixed(0)}%`);
	}
	if (totals.cost > 0) parts.push(theme.fg("warning", `$${totals.cost.toFixed(3)}`));

	lines.push(truncateToWidth(`  ${joinSegments(parts, theme)}`, width, ELLIPSIS));

	// ── Statuses from other extensions ──
	if (state.statuses.size > 0) {
		const text = Array.from(state.statuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, value]) => sanitizeStatus(value))
			.filter((value) => value.length > 0)
			.join("  ");
		if (text.length > 0) lines.push(truncateToWidth(`  ${text}`, width, theme.fg("dim", ELLIPSIS)));
	}

	return lines;
}
