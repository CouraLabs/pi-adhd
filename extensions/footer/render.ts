/**
 * Pure rendering for the pi-pack footer: a single stats line with the agent
 * mode, submode, model, thinking level, context gauge, and cumulative
 * token/cost usage, followed by extension statuses on their own line and any
 * registered sections (see `shared/footer-sections.ts`) last of all.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../../shared/format.ts";
import { CONTEXT_CLOSE, CONTEXT_EMPTY, CONTEXT_FILLED, CONTEXT_HALF, CONTEXT_OPEN, ELLIPSIS, SEPARATOR, THINKING_LEVELS } from "../../shared/glyphs.ts";
import { AGENT_MODE_LABEL, agentModeColor, type AgentMode } from "../../shared/modes.ts";
import { SUBMODE_LABEL, submodeColor, type Submode } from "../../shared/submodes.ts";
import { usageCost, usageGroup, type UsageTotals } from "../../shared/usage.ts";

type ModelInfo = NonNullable<ExtensionContext["model"]>;
type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** Everything the footer needs to draw one frame. */
export interface FooterState {
	/** Active agent mode, shown before the provider/model. */
	mode: AgentMode;
	/** Active submode, shown right after the mode; `"none"` renders nothing. */
	submode: Submode;
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	contextUsage: ContextUsage | undefined;
	usage: UsageTotals;
	/** Cumulative cost of the session's subagent runs, shown parenthesized after the session cost. */
	subagentCost: number;
	statuses: ReadonlyMap<string, string>;
	/**
	 * Pre-rendered lines contributed by other extensions (see
	 * `shared/footer-sections.ts`). Drawn last, after the stats and statuses
	 * lines, so the footer's final block is always the last thing on screen.
	 */
	sections: readonly string[];
}

/**
 * A ten-cell gauge — each cell 10%, each half cell 5% — whose filled cells
 * follow the usage percentage along a teal→red gradient from the active theme.
 * The brackets and the empty cells are dim.
 */
function contextBar(theme: Theme, percent: number, cells = 10): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const halves = Math.round((clamped / 100) * cells * 2);
	const full = Math.floor(halves / 2);
	const half = halves % 2;
	const empty = cells - full - half;
	const color = mixColors(theme.colors.success, theme.colors.error, clamped / 100);
	const filled = CONTEXT_FILLED.repeat(full) + (half === 1 ? CONTEXT_HALF : "");
	return (
		theme.fg("dim", CONTEXT_OPEN) +
		theme.style(filled, { fg: color }) +
		theme.fg("dim", CONTEXT_EMPTY.repeat(empty) + CONTEXT_CLOSE)
	);
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

	// ── One line: agent mode, model, thinking, context, and cumulative usage ──
	const parts: string[] = [];
	const modeLabel = theme.fg(agentModeColor(state.mode), AGENT_MODE_LABEL[state.mode]);
	parts.push(
		state.submode === "none"
			? modeLabel
			: `${modeLabel}${theme.fg("dim", `${SEPARATOR}`)}${theme.fg(submodeColor(state.submode), SUBMODE_LABEL[state.submode])}`,
	);
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
	const group = usageGroup(totals, theme);
	if (group) parts.push(group);
	const cost = usageCost(totals, theme, state.subagentCost);
	if (cost) parts.push(cost);

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

	// ── Sections contributed by other extensions, drawn last ──
	for (const line of state.sections) {
		lines.push(truncateToWidth(line, width, theme.fg("dim", ELLIPSIS)));
	}

	return lines;
}
