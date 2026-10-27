/**
 * loading — the agent-run widget that floats above the editor.
 *
 * Replaces pi's built-in working row (hidden with `setWorkingVisible(false)`)
 * with a persistent widget. While the agent runs it animates the dot spinner
 * and names the current phase with a run clock, the time to first token of the
 * current LLM return, the live output-token estimate (streamed characters ÷ 4,
 * see `./status.ts`), and the live rate — tokens over streaming time only, so
 * the request round trip and the first-token wait never dilute it:
 * `🞘 Reading for 12s ∙ ↓ 3400 ∙ ⭍ 214.2 tok/s ∙ <accent>Session name</> (esc)` — the
 * session name joins once the session has one.
 *
 * When the run settles the widget does not vanish (as pi's working row would) —
 * it keeps the last turn's clock and output tokens on screen while the next
 * prompt is typed, with the session name in accent alongside:
 * `✓ Finished in 45s ∙ ↓ 12300 ∙ ⭍ 275.4 tok/s ∙ <accent>Name</>`. The next run
 * overwrites the summary the moment its tracker exists.
 *
/** Statelessness by construction: every render reads the tracker, the settled
 *  summary, and the session name afresh, so events, ticks, mode recolors, and
 *  theme swaps all flow through the same path — the extension only ever
 *  requests frames. The one piece of internal state is the spinner's
 *  wall-clock frame advance, so extra renders between ticks never skip frames.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { padWidgetLines, WIDGET_LEFT_PADDING } from "../../../shared/format.ts";
import { RATE_GLYPH, SEPARATOR, TURN_DONE } from "../../../shared/glyphs.ts";
import type { WorkingTone } from "./status.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

/** The numbers one loading line draws. */
export interface LoadingFigures {
	/** Formatted run clock ("12s", "1m 30s"). */
	elapsed: string;
	/** Live output-token estimate, raw digits ("3400"). */
	tokens: string;
	/** Tokens per second over streaming time only; undefined with nothing to divide. */
	tps: number | undefined;
}

/** What the widget needs each frame; the extension owns the sources. */
export interface LoadingWidgetSources {
	/** The live run's figures, labeled by phase; undefined while idle. */
	running(): (LoadingFigures & { label: string; tone: WorkingTone }) | undefined;
	/** The last settled run's figures; persists until the next run starts. */
	settled(): LoadingFigures | undefined;
	/** The session's display name, when one is set; undefined while unnamed. */
	sessionName(): string | undefined;
}

/** Hint appended to the running line. */
const ESCAPE_HINT = "(esc)";



/**
 * Phase tone → semantic color token: `accent` while the model's round trip
 * waits or a tool executes, `success` while output streams.
 */
const TONE_TOKEN: Record<WorkingTone, ThemeColor> = {
	prompting: "accent",
	tooling: "accent",
	streaming: "success",
};

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
		// Truncate inside the padded width: the pad is applied after the cut, so a
		// full-width line would otherwise wrap by the padding's column count.
		return padWidgetLines([truncateToWidth(line, Math.max(1, width - WIDGET_LEFT_PADDING.length), theme.fg("dim", "…"))]);
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

	/** `🞘 Answering <muted>for</> 12s ∙ ↓ 3400 ∙ ⭍ 214.2 tok/s ∙ <accent>Name</> (esc)` — the spinner
	 *  rides the default foreground, the label rides its phase's semantic color,
	 *  "for" rides muted, the session name (when one is set) rides accent, and the
	 *  separator joins the segments dim. The name appears only once the session
	 *  has one — the first run of a fresh session runs unnamed. */
	private runningLine({ label, tone, elapsed, tokens, tps }: LoadingFigures & { label: string; tone: WorkingTone }): string {
		const theme = this.theme;
		const spinner = this.spinnerFrame();
		const parts = [
			`${spinner} ${theme.fg(TONE_TOKEN[tone], label)}${theme.fg("muted", " for ")}${theme.fg("text", elapsed)}`,
		];
		parts.push(`${theme.fg("text", "↓")} ${theme.fg("muted", tokens)}`);
		if (tps !== undefined) {
			parts.push(`${theme.fg("warning", RATE_GLYPH)}${theme.fg("dim", ` ${tps.toFixed(1)} tok/s`)}`);
		}
		const sessionName = this.sources.sessionName();
		if (sessionName) parts.push(theme.fg("accent", sessionName));
		return `${parts.join(theme.fg("dim", SEPARATOR))}${theme.fg("muted", ` ${ESCAPE_HINT}`)}`;
	}

	/** `✓ Finished <muted>in</> 45s ∙ ↓ 12300 ∙ ⭍ 275.4 tok/s ∙ <accent>Name</>` — the last turn's
	 *  figures, kept on screen, with the session name once the session has one. */
	private settledLine(): string | undefined {
		const settled = this.sources.settled();
		if (!settled) return undefined;
		const theme = this.theme;
		const parts = [
			`${theme.fg("success", `${TURN_DONE} Finished`)}${theme.fg("muted", " in ")}${theme.fg("text", settled.elapsed)}`,
		];
		parts.push(`${theme.fg("text", "↓")} ${theme.fg("muted", settled.tokens)}`);
		if (settled.tps !== undefined) {
			parts.push(`${theme.fg("warning", RATE_GLYPH)}${theme.fg("dim", ` ${settled.tps.toFixed(1)} tok/s`)}`);
		}
		const sessionName = this.sources.sessionName();
		if (sessionName) parts.push(theme.fg("accent", sessionName));
		return parts.join(theme.fg("dim", SEPARATOR));
	}
}
