import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth, type Color } from "@earendil-works/pi-tui";
import { formatTokens } from "../../../shared/format.ts";
import {
	CONTEXT_GLYPH,
	ELLIPSIS,
	GAUGE_GLYPHS,
	POMODORO_BREAK,
	POMODORO_WORK,
	RATE_LIMIT_FIVE_HOUR_LABEL,
	RATE_LIMIT_SEPARATOR,
	RATE_LIMIT_SEVEN_DAY_LABEL,
	SEPARATOR,
	THINKING_LEVELS,
	TIMER_GLYPH,
} from "../../../shared/glyphs.ts";
import { prettyModelName } from "../../../shared/model-name.ts";
import { agentModeColor, agentModeLabel, type AgentMode } from "../../../shared/modes.ts";
import { formatTimeUntilReset, type RateLimits, type RateLimitWindow } from "../../../shared/rate-limits.ts";
import { SUBMODE_LABEL, submodeColor, type Submode } from "../../../shared/submodes.ts";
import { earliestTimer, formatCountdown, remainingMs, type ActiveTimer } from "../../../shared/timers.ts";
import { usageCost, usageGroup, type UsageTotals } from "../../../shared/usage.ts";

type ModelInfo = NonNullable<ExtensionContext["model"]>;
type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

export interface FooterState {

	mode?: AgentMode;

	submode?: Submode;
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	contextUsage: ContextUsage | undefined;
	usage: UsageTotals;

	spawnCost: number;

	timers: readonly ActiveTimer[];

	rateLimits: RateLimits;
	statuses: ReadonlyMap<string, string>;

	sections: readonly string[];
}

export function contextBar(theme: Theme, percent: number, positions = 5): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const consumed = (clamped / 100) * positions;
	const full = Math.floor(consumed);
	const color = mixColors(theme.colors.success, theme.colors.error, clamped / 100);
	const glyphs: string[] = [];
	for (let position = 0; position < positions; position++) {
		if (position < full) {
			glyphs.push(GAUGE_GLYPHS[3]);
			continue;
		}
		if (position > full || full === positions) {
			glyphs.push(GAUGE_GLYPHS[0]);
			continue;
		}
		const remainder = consumed - full;
		glyphs.push(
			remainder <= 0
				? GAUGE_GLYPHS[0]
				: remainder <= 1 / 3
					? GAUGE_GLYPHS[1]
					: remainder <= 2 / 3
						? GAUGE_GLYPHS[2]
						: GAUGE_GLYPHS[3],
		);
	}

	const lit = full + (full < positions && consumed - full > 0 ? 1 : 0);
	const colored = glyphs
		.map((glyph, position) => (position < lit ? theme.style(glyph, { fg: color }) : theme.fg("dim", glyph)));
	return colored.join("");
}

function contextColor(theme: Theme, percent: number, text: string): string {
	const amount = Math.max(0, Math.min(1, percent / 100));
	return theme.style(text, { fg: mixColors(theme.colors.success, theme.colors.error, amount) });
}

const PLAN_GAUGE_POSITIONS = 5;
const PLAN_GAUGE_PARTIAL_THRESHOLD = 0.5;

function gradientColor(stops: readonly Color[], amount: number): Color {
	const clamped = Math.max(0, Math.min(1, amount));
	const scaled = clamped * (stops.length - 1);
	const lower = Math.min(Math.floor(scaled), stops.length - 2);
	try {
		return mixColors(stops[lower], stops[lower + 1], scaled - lower);
	} catch {
		return stops[Math.round(scaled)];
	}
}

function planGaugeColor(theme: Theme, percent: number): Color {
	return gradientColor([theme.colors.text, theme.colors.warning, theme.colors.error], percent / 100);
}

function planGauge(theme: Theme, percent: number): string {
	const consumed = (Math.max(0, Math.min(100, percent)) / 100) * PLAN_GAUGE_POSITIONS;
	const full = Math.floor(consumed);
	const partial = full < PLAN_GAUGE_POSITIONS && consumed - full >= PLAN_GAUGE_PARTIAL_THRESHOLD ? 1 : 0;
	const color = planGaugeColor(theme, percent);
	const filled = GAUGE_GLYPHS[3].repeat(full);
	const partialCell = partial ? GAUGE_GLYPHS[2] : "";
	const empty = GAUGE_GLYPHS[0].repeat(PLAN_GAUGE_POSITIONS - full - partial);
	return `${filled ? theme.style(filled, { fg: color }) : ""}${partialCell ? theme.style(partialCell, { fg: color }) : ""}${empty ? theme.fg("dim", empty) : ""}`;
}

function planWindowSegment(theme: Theme, label: string, window: RateLimitWindow | undefined): string | undefined {
	if (!window) return undefined;
	const timeLeft = formatTimeUntilReset(window.resetsAt);
	if (!timeLeft) return undefined;
	const mutedDim = (text: string) => theme.style(text, { fg: "muted", dim: true });
	return [
		theme.fg("accent", label),
		theme.fg("muted", `${Math.round(window.percent)}%`),
		planGauge(theme, window.percent),
		mutedDim("in"),
		theme.fg("text", timeLeft),
	].join(" ");
}

function planRateLimitSegment(theme: Theme, limits: RateLimits): string {
	const windows = [
		planWindowSegment(theme, RATE_LIMIT_FIVE_HOUR_LABEL, limits.fiveHour),
		planWindowSegment(theme, RATE_LIMIT_SEVEN_DAY_LABEL, limits.sevenDay),
	].filter((segment): segment is string => segment !== undefined);
	return windows.join(` ${theme.style(RATE_LIMIT_SEPARATOR, { fg: "muted", dim: true })} `);
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

	const parts: string[] = timerSegments(theme, state.timers);

	const submodeLabel =
		state.submode && state.submode !== "none"
			? theme.fg(submodeColor(state.submode), SUBMODE_LABEL[state.submode])
			: undefined;
	if (state.mode) {
		const modeLabel = theme.fg(agentModeColor(state.mode), agentModeLabel(state.mode));
		parts.push(submodeLabel ? `${modeLabel}${theme.fg("dim", `${SEPARATOR}`)}${submodeLabel}` : modeLabel);
	} else if (submodeLabel) {
		parts.push(submodeLabel);
	}
	if (state.model) {
		parts.push(theme.fg("text", prettyModelName(state.model)));
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
		const gaugeColor = mixColors(theme.colors.success, theme.colors.error, Math.max(0, Math.min(100, percent)) / 100);
		const icon = theme.style(CONTEXT_GLYPH, { fg: gaugeColor });
		parts.push(`${icon} ${theme.fg("dim", `${Math.round(percent)}%`)} ${contextBar(theme, percent)} ${contextColor(theme, percent, label)}`);
	} else if (contextWindow) {
		parts.push(theme.fg("dim", `ctx ?/${formatTokens(contextWindow)}`));
	}

	const totals = state.usage;
	const group = usageGroup(totals, theme);
	if (group) parts.push(group);
	const cost = usageCost(totals, theme, state.spawnCost);
	if (cost) parts.push(cost);
	if (state.mode === "claude") parts.push(planRateLimitSegment(theme, state.rateLimits));

	lines.push(truncateToWidth(` ${joinSegments(parts, theme)}`, width, ELLIPSIS));

	if (state.statuses.size > 0) {
		const text = Array.from(state.statuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, value]) => sanitizeStatus(value))
			.filter((value) => value.length > 0)
			.join("  ");
		if (text.length > 0) lines.push(truncateToWidth(`  ${text}`, width, theme.fg("dim", ELLIPSIS)));
	}

	for (const line of state.sections) {
		lines.push(truncateToWidth(line, width, theme.fg("dim", ELLIPSIS)));
	}

	return lines;
}
