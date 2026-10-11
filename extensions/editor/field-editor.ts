/**
 * The pi-pack prompt editor: a closed, field-style box around the built-in
 * editor with a `❯` marker, the working indicator pushed to the top-right, and
 * cumulative token/cost usage on the bottom rule.
 */

import {
	CustomEditor,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "../../shared/format.ts";
import { DB_GLYPH, PROMPT } from "../../shared/glyphs.ts";
import type { UsageTotals } from "../../shared/usage.ts";

type StatusIndicatorLike = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];

/** Fields the editor exposes at runtime but not through its public type. */
interface EditorInternals {
	renderedVisibleLineCount?: number;
}

/** Cumulative token/cost usage plus the theme needed to draw the segment. */
export interface EditorUsageInfo {
	totals: UsageTotals;
	theme: Theme;
}

export type UsageProvider = () => EditorUsageInfo | undefined;

export class FieldEditor extends CustomEditor {
	private indicator: StatusIndicatorLike = undefined;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getUsage: UsageProvider,
	) {
		super(tui, theme, keybindings, { paddingX: 0, embedWorkingStatus: true });
	}

	setWorkingStatusIndicator(indicator: StatusIndicatorLike): void {
		this.indicator = indicator;
		super.setWorkingStatusIndicator(indicator);
	}

	/** Paint a border/prompt fragment with the thinking-level color pi assigns to the editor. */
	private paint(text: string): string {
		return this.borderColor(text);
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		// Too narrow for the prompt marker: fall back to the plain editor.
		if (width < 3) return super.render(width);

		// Reserve two columns for the `❯ ` marker.
		const contentWidth = Math.max(1, width - 2);
		const lines = super.render(contentWidth);
		if (lines.length < 2) return lines;

		const internals = this as unknown as EditorInternals;
		const maxVisible = Math.max(0, lines.length - 2);
		const visibleCount = Math.min(internals.renderedVisibleLineCount ?? maxVisible, maxVisible);
		const content = lines.slice(1, 1 + visibleCount);
		const trailing = lines.slice(1 + visibleCount + 1);

		const out: string[] = [this.topLine(width)];
		content.forEach((line, index) => {
			const prefix = index === 0 ? `${PROMPT} ` : "  ";
			out.push(`${this.paint(prefix)}${line}`);
		});
		out.push(this.bottomLine(width));

		// Autocomplete suggestions are rendered after the editor; keep them full width.
		for (const line of trailing) {
			out.push(line + " ".repeat(Math.max(0, width - visibleWidth(line))));
		}
		return out;
	}

	/** Token/cost usage, matching the pi-pack footer. */
	private usageSegment(): string {
		const info = this.getUsage();
		if (!info) return "";
		const { totals, theme } = info;
		const parts: string[] = [];
		if (totals.input > 0) parts.push(theme.fg("success", `↑${formatTokens(totals.input)}`));
		if (totals.output > 0) parts.push(theme.fg("accent", `↓${formatTokens(totals.output)}`));
		const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
		if (promptTokens > 0) {
			const cacheHit = (totals.cacheRead / promptTokens) * 100;
			parts.push(theme.fg("text", `${DB_GLYPH} ${cacheHit.toFixed(0)}%`));
		}
		if (totals.cost > 0) parts.push(theme.fg("warning", `$${totals.cost.toFixed(3)}`));
		return parts.join(theme.fg("dim", " · "));
	}

	/** Top rule with the working indicator pushed to the right. */
	private topLine(width: number): string {
		if (width <= 0) return "";
		const status = this.indicator?.renderInBorder(Math.max(0, width - 3)) ?? "";
		const statusWidth = visibleWidth(status);
		if (statusWidth === 0) return this.paint("─".repeat(width));

		const left = Math.max(0, width - 3 - statusWidth);
		return `${this.paint(`${"─".repeat(left)} `)}${status}${this.paint(" ─")}`;
	}

	/** Bottom rule with the token/cost usage pushed to the right. */
	private bottomLine(width: number): string {
		if (width <= 0) return "";
		const usage = this.usageSegment();
		if (visibleWidth(usage) === 0) return this.paint("─".repeat(width));

		const available = Math.max(0, width - 3);
		const trimmed = visibleWidth(usage) > available ? truncateToWidth(usage, available, "") : usage;
		const left = Math.max(0, width - 3 - visibleWidth(trimmed));
		const rule = this.paint("─".repeat(left) + " ");
		const tail = this.paint(" ─");
		return rule + trimmed + tail;
	}
}
