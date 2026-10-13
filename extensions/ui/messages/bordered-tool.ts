import type { Component } from "@earendil-works/pi-tui";
import { RULE } from "../../../shared/glyphs.ts";

/**
 * A component that draws a status-colored rule to the left of another component.
 * The inner component is handed the width left over after the rule and its padding.
 */
export class BorderedTool implements Component {
	inner: Component | undefined;
	private paint: (text: string) => string = (text) => text;
	private emphasize: (text: string) => string = (text) => text;
	private pad = 1;
	private boldFirstLine = false;

	set(
		inner: Component,
		paint: (text: string) => string,
		pad: number,
		emphasize: (text: string) => string,
		boldFirstLine: boolean,
	): void {
		this.inner = inner;
		this.paint = paint;
		this.pad = Math.max(0, pad);
		this.emphasize = emphasize;
		this.boldFirstLine = boldFirstLine;
	}

	render(width: number): string[] {
		// The prefix is the leading margin, the rule, and the pad: 2 + pad columns.
		// The inner component must get exactly what is left — pi's built-in
		// renderers pad every line to the width they are given, so one column too
		// many overflows the terminal and pi-tui treats an overlong line as fatal.
		const prefixWidth = 2 + this.pad;
		if (width <= prefixWidth) return [];
		const lines = this.inner?.render(width - prefixWidth) ?? [];
		const prefix = " " + this.paint(RULE) + " ".repeat(this.pad);
		return lines
			.filter((line) => line.trim())
			.map((line, index) => prefix + (this.boldFirstLine && index === 0 ? this.bold(line) : line));
	}

	/** Force bold across the whole line, surviving the renderer's own bold resets (`\x1b[22m`). */
	private bold(line: string): string {
		return this.emphasize(line.replace(/\x1b\[22m/g, "\x1b[1m"));
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}
