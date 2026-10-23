/**
 * Pure rendering for the pi-adhd footer: a single stats line with the agent
 * mode, submode, model, thinking level, context gauge, and cumulative
 * token/cost usage, followed by extension statuses on their own line and any
 * registered sections (see `shared/footer-sections.ts`) last of all.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../../../shared/format.ts";
import {
	CONTEXT_CLOSE,
	CONTEXT_EMPTY,
	CONTEXT_FILLED,
	CONTEXT_HALF,
	CONTEXT_OPEN,
	ELLIPSIS,
	POMODORO_BREAK,
	POMODORO_WORK,
	SEPARATOR,
	THINKING_LEVELS,
	TIMER_GLYPH,
} from "../../../shared/glyphs.ts";
import { AGENT_MODE_LABEL, agentModeColor, type AgentMode } from "../../../shared/modes.ts";
import { SUBMODE_LABEL, submodeColor, type Submode } from "../../../shared/submodes.ts";
import { earliestTimer, formatCountdown, remainingMs, type ActiveTimer } from "../../../shared/timers.ts";
import { usageCost, usageGroup, type UsageTotals } from "../../../shared/usage.ts";

type ModelInfo = NonNullable<ExtensionContext["model"]>;
type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** Everything the footer needs to draw one frame. */
export interface FooterState {
	/** Active agent mode, shown before the provider/model; undefined when the `modes` extension is not loaded. */
	mode?: AgentMode;
	/**
	 * Active submode, shown right after the mode; "none" renders nothing and
	 * undefined (the `submodes` extension not loaded) renders nothing either.
	 */
	submode?: Submode;
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	contextUsage: ContextUsage | undefined;
	/** Generation rate of the most recently completed assistant message, in tokens/sec; undefined until one completes. */
	tps?: number;
	usage: UsageTotals;
	/** Cumulative cost of the session's spawn runs, shown parenthesized after the session cost. */
	spawnCost: number;
	/** Running countdowns, shown before the agent mode; the earliest timer wins. */
	timers: readonly ActiveTimer[];
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

/**
 * The countdown segments drawn before the agent mode: the earliest plain timer
 * and, when one is running, the current pomodoro phase. Both read the shared
 * timer registry and recompute on every frame, so they tick down live.
 */
function timerSegments(theme: Theme, timers: readonly ActiveTimer[]): string[] {
	const parts: string[] = [];
	const timer = earliestTimer(timers, "timer");
	if (timer) parts.push(theme.fg("accent", `${TIMER_GLYPH} ${formatCountdown(remainingMs(timer))}`));

	const pomodoro = earliestTimer(timers, "pomodoro");
	if (pomodoro) {
		const work = pomodoro.phase === "work";
		const glyph = work ? POMODORO_WORK : POMODORO_BREAK;
		const label = `${glyph} ${pomodoro.name} ${formatCountdown(remainingMs(pomodoro))}`;
		parts.push(theme.fg(work ? "warning" : "success", label));
	}
	return parts;
}

export function renderFooter(state: FooterState, width: number, theme: Theme): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];

	// ── One line: timers, agent mode, model, thinking, context, and cumulative usage ──
	const parts: string[] = timerSegments(theme, state.timers);
	// A segment renders only when the extension that owns its state is loaded:
	// `getAgentMode()`/`getSubmode()` always return a stored value, so an absent
	// owner must be signaled with undefined rather than read as a real mode.
	// The submode segment is independent of the mode segment: `submodes` loads
	// and enforces its toolset without `modes`, so it renders on its own when
	// the mode extension is absent.
	const submodeLabel =
		state.submode && state.submode !== "none"
			? theme.fg(submodeColor(state.submode), SUBMODE_LABEL[state.submode])
			: undefined;
	if (state.mode) {
		const modeLabel = theme.fg(agentModeColor(state.mode), AGENT_MODE_LABEL[state.mode]);
		parts.push(submodeLabel ? `${modeLabel}${theme.fg("dim", `${SEPARATOR}`)}${submodeLabel}` : modeLabel);
	} else if (submodeLabel) {
		parts.push(submodeLabel);
	}
	if (state.model) {
		parts.push(theme.fg("text", `${state.model.provider}/${state.model.id}`));
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
		const label = `${formatTokens(contextUsage.tokens ?? 0)}/${formatTokens(contextWindow)}`;
		parts.push(`${theme.fg("dim", `${Math.round(percent)}%`)} ${contextBar(theme, percent)} ${contextColor(theme, percent, label)}`);
	} else if (contextWindow) {
		parts.push(theme.fg("dim", `ctx ?/${formatTokens(contextWindow)}`));
	}

	// Defensive: the index side only ever stores a finite positive rate, but a
	// nonsense value must not render even if one slips through.
	if (state.tps !== undefined && Number.isFinite(state.tps) && state.tps > 0) {
		parts.push(theme.fg("dim", `${state.tps.toFixed(1)} tok/s`));
	}

	const totals = state.usage;
	const group = usageGroup(totals, theme);
	if (group) parts.push(group);
	const cost = usageCost(totals, theme, state.spawnCost);
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
