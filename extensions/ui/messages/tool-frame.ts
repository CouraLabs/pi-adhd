import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { TOOL_PICK } from "../../../shared/glyphs.ts";

/**
 * Frames a tool component inline — no left rule, no indentation shift.
 *
 * In header mode the first rendered line gains the status-colored pick glyph,
 * and a tool-name token leading that line is rewritten to PascalCase in place:
 * the style runs wrapped around the token are kept, so the name inherits the
 * renderer's own color and weight. Renderers whose header leads with something
 * else — the shell prompt (`$`), a classification tag — get the icon only.
 * In plain mode, used for result bodies below the call header, lines pass
 * through unmodified.
 *
 * The icon and its space are reserved by rendering the inner at the reduced
 * width; the header is truncated as a final guard, since pi-tui treats an
 * overlong line as fatal.
 */
export class ToolFrame implements Component {
	inner: Component | undefined;
	/** Paint for the status icon; `undefined` switches the frame to plain mode. */
	private paint: ((text: string) => string) | undefined;
	private name = "";

	set(inner: Component, paint: ((text: string) => string) | undefined, name: string): void {
		this.inner = inner;
		this.paint = paint;
		this.name = name;
	}

	render(width: number): string[] {
		const lines = this.inner?.render(width - this.prefixWidth) ?? [];
		// Never mutate: inner components cache their rendered arrays and reuse them.
		if (!this.paint || lines.length === 0 || !lines[0].trim()) return lines;
		const line = lines[0];
		const indent = leadingIndent(line);
		const icon = `${this.paint(TOOL_PICK)}${indent || " "}`;
		return [truncateToWidth(icon + spliceName(line, this.name), width), ...lines.slice(1)];
	}

	private get prefixWidth(): number {
		return this.paint ? 2 : 0;
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}

/**
 * Rewrite a tool-name token at the start of a line to PascalCase.
 *
 * Line shape: `[indent][open codes][plain][close codes][rest]`. The plain run
 * may be exactly the name (`read`) or start with it and continue inside the
 * same style run (`read skill`). Nothing is rewritten when the run's first
 * word is not the tool name (`$ npm test`, `[skill] file`) or when the match
 * runs into an identifier boundary (`read` vs `readme`). Separators inside the
 * token are ignored, so a renderer's own PascalCase output (`JobKill`) still
 * matches the `job-kill` name and is left as it already is.
 */
function spliceName(line: string, name: string): string {
	let index = 0;
	while (line[index] === " ") index++;
	const indent = line.slice(0, index);
	const openEnd = escapeEndAfter(line, index);
	const open = line.slice(index, openEnd);

	const plainEnd = plainEndFrom(line, openEnd);
	const plain = line.slice(openEnd, plainEnd);
	const word = wordPrefix(plain);
	if (!word || normalizeToken(word) !== normalizeToken(name)) return line;

	const closeEnd = escapeEndAfter(line, plainEnd);
	const close = line.slice(plainEnd, closeEnd);
	const tail = plain.slice(word.length);
	const rest = line.slice(closeEnd);
	const replacement = tail ? `${pascalCase(name)}${tail}` : pascalCase(name);
	return `${open}${replacement}${close}${rest}`;
}

/** First run of identifier characters (the tool-name token). */
function wordPrefix(text: string): string {
	return /^\w+/.exec(text)?.[0] ?? "";
}

/** Case and separators removed, for matching names across renderers (`JobKill` ≍ `job-kill`). */
function normalizeToken(text: string): string {
	return text.replace(/[-_.]/g, "").toLowerCase();
}

/** End of the plain-text run starting at `position` (next escape or end of line). */
function plainEndFrom(line: string, position: number): number {
	let end = position;
	while (end < line.length && line[end] !== "\x1b") end++;
	return end;
}

/** End of the run of escape sequences starting at `position`. */
function escapeEndAfter(line: string, position: number): number {
	let end = position;
	while (line.startsWith("\x1b[", end)) end += escapeAt(line, end).length;
	return end;
}

/** The escape sequence at `position` (caller must have checked the prefix), or "" when none. */
function escapeAt(line: string, position: number): string {
	return /^\x1b\[[0-9;]*m/.exec(line.slice(position))?.[0] ?? "";
}

/** Indentation spaces at the start of a line; consumed by the icon prefix. */
function leadingIndent(line: string): string {
	return /^ */.exec(line)?.[0] ?? "";
}

/**
 * `[-_.\s]`-separated words (and camelCase humps) to PascalCase:
 * `job-kill` → `JobKill`, `web_search_prime` → `WebSearchPrime`.
 */
export function pascalCase(name: string): string {
	return name
		.split(/[-_.\s]+|[a-z](?=[A-Z0-9])/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}
