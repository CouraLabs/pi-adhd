/**
 * Pure rendering for the pi-pack footer: model + context gauge on the first
 * row, git + location + counters on the second, and extension statuses below.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../../shared/format.ts";
import { ELLIPSIS } from "../../shared/glyphs.ts";
import { gitChangeCount, type GitInfo } from "./git.ts";

type ModelInfo = NonNullable<ExtensionContext["model"]>;
type ContextUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

/** Everything the footer needs to draw one frame. */
export interface FooterState {
	model: ModelInfo | undefined;
	thinkingLevel: ThinkingLevel;
	contextUsage: ContextUsage | undefined;
	git: GitInfo;
	gitBranch: string | null;
	cwd: string | undefined;
	turns: number;
	tools: number;
	statuses: ReadonlyMap<string, string>;
}

/** A gauge whose color follows the usage percentage along a teal→red gradient from the active theme. */
function contextBar(theme: Theme, percent: number, cells = 8): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * cells);
	const color = mixColors(theme.colors.success, theme.colors.error, clamped / 100);
	return theme.style("█".repeat(filled), { fg: color }) + theme.fg("dim", "░".repeat(cells - filled));
}

/** Color context text along the same teal→red gradient as the gauge. */
function contextColor(theme: Theme, percent: number, text: string): string {
	const amount = Math.max(0, Math.min(1, percent / 100));
	return theme.style(text, { fg: mixColors(theme.colors.success, theme.colors.error, amount) });
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && (cwd === home || cwd.startsWith(`${home}/`))) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}

function sanitizeStatus(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function joinSegments(parts: string[], theme: Theme): string {
	return parts.filter((part) => part.length > 0).join(theme.fg("dim", " · "));
}

/** Pad/truncate so `left` and `right` fill exactly `width` columns. */
function alignRow(left: string, right: string, width: number): string {
	if (width <= 0) return "";
	const leftWidth = visibleWidth(left);
	if (right.length === 0) return truncateToWidth(left, width, ELLIPSIS);

	const rightWidth = visibleWidth(right);
	if (leftWidth + rightWidth + 1 <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}

	const availableForRight = width - leftWidth - 1;
	if (availableForRight <= 0) return truncateToWidth(left, width, ELLIPSIS);

	const trimmedRight = truncateToWidth(right, availableForRight, "");
	return left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(trimmedRight))) + trimmedRight;
}

function formatGit(theme: Theme, git: GitInfo, fallbackBranch: string | null): string {
	const branch = git.branch ?? (fallbackBranch && fallbackBranch !== "detached" ? fallbackBranch : null);
	const changed = gitChangeCount(git);
	const hasRepo = branch !== null || changed > 0 || git.ahead > 0 || git.behind > 0 || git.untracked > 0;

	if (!hasRepo) return theme.fg("dim", "⌂ no repo");

	const parts = [theme.fg("accent", `⎇ ${branch ?? "detached"}`)];
	if (git.ahead > 0) parts.push(theme.fg("success", `↑${git.ahead}`));
	if (git.behind > 0) parts.push(theme.fg("warning", `↓${git.behind}`));
	if (changed > 0) parts.push(theme.fg("warning", `✚${changed}`));
	if (git.untracked > 0) parts.push(theme.fg("dim", `?${git.untracked}`));
	if (git.conflicts > 0) parts.push(theme.fg("error", `⚠${git.conflicts}`));
	return parts.join(" ");
}

export function renderFooter(state: FooterState, width: number, theme: Theme): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];

	// ── Row 1: model, thinking, context gauge ──
	const statsParts: string[] = [];
	if (state.model) {
		statsParts.push(theme.fg("accent", `${state.model.provider}/${state.model.id}`));
		if (state.model.reasoning) {
			const level = state.thinkingLevel;
			statsParts.push(theme.getThinkingBorderColor(level)(`⚙ ${level}`));
		}
	}

	const usage = state.contextUsage;
	const contextWindow = usage?.contextWindow ?? state.model?.contextWindow;
	if (usage && usage.percent !== null && contextWindow) {
		const percent = usage.percent;
		const consumed = usage.tokens ?? Math.round((percent / 100) * contextWindow);
		const label = `${formatTokens(consumed)}/${formatTokens(contextWindow)} (${Math.round(percent)}%)`;
		statsParts.push(`${contextBar(theme, percent)} ${contextColor(theme, percent, label)}`);
	} else if (contextWindow) {
		statsParts.push(theme.fg("dim", `ctx ?/${formatTokens(contextWindow)}`));
	}
	lines.push(alignRow(joinSegments(statsParts, theme), "", width));

	// ── Row 2: git, location, counters ──
	const leftParts: string[] = [];
	leftParts.push(formatGit(theme, state.git, state.gitBranch));
	if (state.cwd) leftParts.push(theme.fg("text", formatCwd(state.cwd)));
	if (state.turns > 0) {
		leftParts.push(theme.fg("dim", `${state.turns} ${state.turns === 1 ? "turn" : "turns"}`));
	}
	if (state.tools > 0) leftParts.push(theme.fg("dim", `${state.tools} tools`));
	lines.push(alignRow(joinSegments(leftParts, theme), "", width));

	// ── Statuses from other extensions ──
	if (state.statuses.size > 0) {
		const text = Array.from(state.statuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, value]) => sanitizeStatus(value))
			.filter((value) => value.length > 0)
			.join("  ");
		if (text.length > 0) lines.push(truncateToWidth(text, width, theme.fg("dim", ELLIPSIS)));
	}

	return lines;
}
