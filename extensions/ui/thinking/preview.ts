/**
 * thinking/preview — the compact reasoning block and duration formatting.
 *
 * `StrictThinkingPreview` renders the styled heading and the tail of the
 * reasoning text. When the text is longer than the configured budget it appends
 * a hint naming how many lines are hidden and the keybinding that expands the
 * full block to the heading line. Output is cached per (heading, text, width)
 * because the component is re-rendered on every animation frame.
 */

import { getKeybindings, Text, type Component } from "@earendil-works/pi-tui";
import { thinkingConfig } from "./config.ts";

/** Format a duration as `ms`, `Ns`, `Nm`, or `Nm Ns`. */
export function formatThoughtDuration(durationMs: number): string {
	if (durationMs < 1_000) {
		return `${Math.max(1, Math.round(durationMs))}ms`;
	}

	const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `${seconds}s`;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** The keybinding hint that expands a collapsed thinking block, if bound. */
export function getThinkingToggleHint(): string | undefined {
	const keys = getKeybindings().getKeys("app.thinking.toggle");
	return keys.length > 0 ? `${keys.join("/")} to expand` : undefined;
}

/** A compact reasoning block: heading with an optional hidden-line hint, then the tail of the body. */
export class StrictThinkingPreview implements Component {
	private heading: string;
	private text: string;
	private padding: number;
	private style: (text: string) => string;

	private cachedHeading?: string;
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(heading: string, text: string, padding: number, style: (text: string) => string) {
		this.heading = heading;
		this.text = text;
		this.padding = padding;
		this.style = style;
	}

	render(width: number): string[] {
		if (
			this.cachedLines &&
			this.cachedHeading === this.heading &&
			this.cachedText === this.text &&
			this.cachedWidth === width
		) {
			return this.cachedLines;
		}

		const lines = new Text(this.style(this.text), this.padding, 0).render(width);
		const previewLines = thinkingConfig().previewLines;
		const truncated = previewLines > 0 && lines.length > previewLines;

		let heading = this.heading;
		if (truncated) {
			const hiddenLines = lines.length - previewLines;
			const noun = hiddenLines === 1 ? "line" : "lines";
			const toggleHint = getThinkingToggleHint();
			const hint = `(${hiddenLines} more ${noun}${toggleHint ? `, ${toggleHint}` : ""})`;
			heading = `${this.heading} ${this.style(hint)}`;
		}

		const shownLines = previewLines > 0 ? lines.slice(-previewLines) : lines;
		const result = [...new Text(heading, this.padding, 0).render(width), ...shownLines];

		this.cachedHeading = this.heading;
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;

		return result;
	}

	invalidate(): void {
		this.cachedHeading = undefined;
		this.cachedText = undefined;
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
