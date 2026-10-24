/**
 * loading — the agent-run widget that floats above the editor.
 *
 * Replaces pi's built-in working row (hidden with `setWorkingVisible(false)`)
 * with a persistent widget. While the agent runs it animates the dot spinner
 * and names the current phase with a run clock, the time to first token of the
 * current LLM return, the live output-token estimate (streamed characters ÷ 4,
 * see `./status.ts`), and the live rate — tokens over streaming time only, so
 * the request round trip and the first-token wait never dilute it:
 * `🞘 Reading for 12s → TFT 1.8s → ↓ 3400 → ⭍ 214.2 tok/s (esc)`.
 *
 * When the run settles the widget does not vanish (as pi's working row would) —
 * it keeps the last turn's clock and output tokens on screen while the next
 * prompt is typed: `✓ Finished in 45s → TFT 1.8s → ↓ 12300 → ⭍ 275.4 tok/s`. The next run
 * overwrites the summary the moment its tracker exists.
 *
 * Statelessness by construction: every render reads the tracker and the
 * settled summary afresh, so events, ticks, mode recolors, and theme swaps all
 * flow through the same path — the extension only ever requests frames. The
 * one piece of internal state is the spinner's wall-clock frame advance, so
 * extra renders between ticks never skip frames.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { padWidgetLines } from "../../../shared/format.ts";
import { RATE_GLYPH, TURN_DONE } from "../../../shared/glyphs.ts";
import { agentModeBorderColor, getAgentMode } from "../../../shared/modes.ts";
import { formatCountdown } from "../../../shared/timers.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

/** The numbers one loading line draws. */
export interface LoadingFigures {
	/** Formatted run clock ("12s", "1m 30s"). */
	elapsed: string;
	/** Live output-token estimate, raw digits ("3400"). */
	tokens: string;
	/** Tokens per second over streaming time only; undefined with nothing to divide. */
	tps: number | undefined;
	/** Time to first token of the current (or most recent) LLM return, in ms. */
	tftMs: number | undefined;
}

/** What the widget needs each frame; the extension owns the sources. */
export interface LoadingWidgetSources {
	/** The live run's figures, labeled by phase; undefined while idle. */
	running(): (LoadingFigures & { label: string }) | undefined;
	/** The last settled run's figures; persists until the next run starts. */
	settled(): LoadingFigures | undefined;
}

/** Hint appended to the running line. */
const ESCAPE_HINT = "(esc)";

/** Separator between the loading line's segments. */
const SEGMENT_ARROW = " → ";

/** TFT keeps sub-second precision where it matters, whole units beyond 10s. */
function formatTft(ms: number): string {
	return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : formatCountdown(ms);
}

export class LoadingWidget {
	private readonly theme: Theme;
	private readonly sources: LoadingWidgetSources;
	private frameIndex = 0;
	private lastAdvance: number;

	constructor(theme: Theme, sources: LoadingWidgetSources) {
		this.theme = theme;
		this.sources = sources;
		this.lastAdvance = Date.now();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.theme;
		const running = this.sources.running();
		const line = running ? this.runningLine(running) : this.settledLine();
		if (line === undefined) return [];
		return padWidgetLines([truncateToWidth(line, width, theme.fg("dim", "…"))]);
	}

	invalidate(): void {
		// Everything is recomputed per render; nothing cached to drop.
	}

	/** The spinner frame, advanced at most once per spinner interval. */
	private spinnerFrame(): string {
		const now = Date.now();
		if (now - this.lastAdvance >= SPINNER_INTERVAL_MS) {
			this.lastAdvance = now;
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
		}
		return SPINNER_FRAMES[this.frameIndex];
	}

	/** `🞘 Answering <muted>for</> 12s → TFT 1.8s → ↓ 3400 → ⭍ 214.2 tok/s (esc)` — the spinner
	 *  rides the mode border, "for" rides muted, and the arrow joins the segments dim. */
	private runningLine({ label, elapsed, tokens, tps, tftMs }: LoadingFigures & { label: string }): string {
		const theme = this.theme;
		const spinner = theme.fg(agentModeBorderColor(getAgentMode()), this.spinnerFrame());
		const parts = [
			`${spinner} ${theme.fg("accent", label)}${theme.fg("muted", " for ")}${theme.fg("text", elapsed)}`,
		];
		if (tftMs !== undefined) parts.push(theme.fg("dim", `TFT ${formatTft(tftMs)}`));
		parts.push(`${theme.fg("text", "↓")} ${theme.fg("muted", tokens)}`);
		if (tps !== undefined) {
			parts.push(`${theme.fg("warning", RATE_GLYPH)}${theme.fg("dim", ` ${tps.toFixed(1)} tok/s`)}`);
		}
		return `${parts.join(theme.fg("dim", SEGMENT_ARROW))}${theme.fg("muted", ` ${ESCAPE_HINT}`)}`;
	}

	/** `✓ Finished <muted>in</> 45s → TFT 1.8s → ↓ 12300 → ⭍ 275.4 tok/s` — the last turn's
	 *  figures, kept on screen; the TFT is the most recent return's wait. */
	private settledLine(): string | undefined {
		const settled = this.sources.settled();
		if (!settled) return undefined;
		const theme = this.theme;
		const parts = [
			`${theme.fg("success", `${TURN_DONE} Finished`)}${theme.fg("muted", " in ")}${theme.fg("text", settled.elapsed)}`,
		];
		if (settled.tftMs !== undefined) parts.push(theme.fg("dim", `TFT ${formatTft(settled.tftMs)}`));
		parts.push(`${theme.fg("text", "↓")} ${theme.fg("muted", settled.tokens)}`);
		if (settled.tps !== undefined) {
			parts.push(`${theme.fg("warning", RATE_GLYPH)}${theme.fg("dim", ` ${settled.tps.toFixed(1)} tok/s`)}`);
		}
		return parts.join(theme.fg("dim", SEGMENT_ARROW));
	}
}
