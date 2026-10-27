import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { padWidgetLines, WIDGET_LEFT_PADDING } from "../../../shared/format.ts";
import { RATE_GLYPH, SEPARATOR, TURN_DONE } from "../../../shared/glyphs.ts";
import type { WorkingTone } from "./status.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

export interface LoadingFigures {

	elapsed: string;

	tokens: string;

	tps: number | undefined;
}

export interface LoadingWidgetSources {

	running(): (LoadingFigures & { label: string; tone: WorkingTone }) | undefined;

	settled(): LoadingFigures | undefined;

	sessionName(): string | undefined;
}

const ESCAPE_HINT = "(esc)";

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

		return padWidgetLines([truncateToWidth(line, Math.max(1, width - WIDGET_LEFT_PADDING.length), theme.fg("dim", "…"))]);
	}

	invalidate(): void {

	}

	private spinnerFrame(): string {
		const now = Date.now();
		if (now - this.lastAdvance >= SPINNER_INTERVAL_MS) {
			this.lastAdvance = now;
			this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
		}
		return SPINNER_FRAMES[this.frameIndex];
	}

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
