import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { TOOL_PICK } from "../../../shared/glyphs.ts";

/** SGR escape sequence: `\x1b[0-9;…m`. */
const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
/** OSC-8 hyperlink wrapper (open carrying the URL, or empty-payload terminator). */
const OSC_LINK_PATTERN = /\x1b\]8;;[^\x1b]*\x1b\\/g;

/** Strip SGR color codes and OSC-8 wrappers, keeping the link's display text. */
function displayOf(line: string): string {
	return line.replace(SGR_PATTERN, "").replace(OSC_LINK_PATTERN, "");
}

/**
 * Frames a tool component inline — no left rule, no indentation shift.
 *
 * On the header row — the first row with visible content; Box-based renderers
 * like `edit` lead with blank pad rows — a status-colored pick glyph rides the
 * front and the tool-name token is rewritten to PascalCase in place. The two
 * icon columns are paid for by shedding pad columns the inner row already
 * carries; short headers just carry them in front. Renderers whose header
 * leads with something else — the shell prompt (`$`), a classification tag —
 * get the icon only.
 *
 * In plain mode (`paint` undefined) — result bodies under the call header —
 * rows pass through unmodified. Never mutating: the inner caches its rendered
 * array between frames, so only a copied array leaves this component.
 */
/** Columns the icon prefix spends on the header row (`<glyph> `). */
const ICON_WIDTH = 2;

export class ToolFrame implements Component {
	inner: Component | undefined;
	/** Paint for the status icon; `undefined` switches the frame to plain mode. */
	private paint: ((text: string) => string) | undefined;
	/** Restyler for the spliced tool-name token; the splice keeps pi's styling when absent. */
	private namePaint: ((text: string) => string) | undefined;
	private name = "";

	set(
		inner: Component,
		paint: ((text: string) => string) | undefined,
		name: string,
		namePaint?: (text: string) => string,
	): void {
		this.inner = inner;
		this.paint = paint;
		this.name = name;
		this.namePaint = namePaint;
	}

	render(width: number): string[] {
		// Below two columns the icon prefix cannot fit without an over-wide line.
		if (width <= 1) return [];
		const lines = this.inner?.render(width) ?? [];
		if (lines.length === 0) return lines;
		// Copied so the header splice below never mutates the inner's cached array.
		const rows = [...lines];
		if (!this.paint) return rows;
		const head = lines.findIndex((line) => line.trim() !== "");
		if (head < 0) return rows;
		// The original row keeps every escape (splice + colors below work on it);
		// the display twin — OSC-8 wrappers and SGR codes stripped, only plain
		// text left — exists for measurement, because width utils count those
		// invisible bytes as cells and would score linked headers ~30 wide.
		const original = lines[head];
		const visual = displayOf(original).replace(SGR_PATTERN, "");
		const leadCount = /^ +/.exec(visual)?.[0].length ?? 0;
		const icon = this.paint(TOOL_PICK);
		const budget = width - ICON_WIDTH;
		let framed: string;
		if (leadCount > 0) {
			// Lead pad cells (Box renderers) free the room; the icon and a
			// separator go where the pad was, the splice rewrites the name.
			const freed = Math.min(leadCount, ICON_WIDTH);
			let body = spliceName(trimLead(original), this.name, this.namePaint);
			// Make up any remaining columns from the row's own trailing pad.
			body = shedTrailingPad(body, ICON_WIDTH - freed);
			framed = `${icon} ${body}`;
		} else {
			let body = spliceName(trimLead(original), this.name, this.namePaint);
			// No lead pad: shed the full icon cost from the row's trailing pad.
			body = shedTrailingPad(body, ICON_WIDTH);
			if (visibleWidth(visual) + ICON_WIDTH > width) {
				// Over-wide without enough pad: cut so icon + separator fit
				// (rare: only rows whose content itself exceeds the budget).
				body = truncateToWidth(body, budget);
			}
			framed = `${icon} ${body}`;
		}
		rows[head] = framed;
		return rows;
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}

/**
 * Rewrite a tool-name token at the start of a line to PascalCase, restyled by
 * `namePaint` when given. The restyle wraps only the name token; the tail of
 * the run (`read skill`) and everything after keep the renderer's own styling.
 *
 * Line shape: `[open codes][plain][close codes][rest]`. The plain run may be
 * exactly the name (`read`) or start with it and continue inside the same
 * style run (`read skill`). Nothing is rewritten when the run's first word is
 * not the tool name (`$ npm test`, `[skill] file`) or when the match runs
 * into an identifier boundary (`read` vs `readme`). Separators are ignored
 * when matching, so a renderer's own PascalCase output (`JobKill`) still
 * matches the `job-kill` name and is left already correct.
 */
function spliceName(line: string, name: string, namePaint?: (text: string) => string): string {
	const openEnd = escapeEndAfter(line, 0);
	const open = line.slice(0, openEnd);

	const plainEnd = plainEndFrom(line, openEnd);
	const plain = line.slice(openEnd, plainEnd);
	const word = wordPrefix(plain);
	if (!word || normalizeToken(word) !== normalizeToken(name)) return line;

	const closeEnd = escapeEndAfter(line, plainEnd);
	const close = line.slice(plainEnd, closeEnd);
	const tail = plain.slice(word.length);
	const rest = line.slice(closeEnd);
	const title = pascalCase(name);
	// A tail that starts a real word (`read skill`) belongs to the renderer's
	// original run, so the restyle wraps only the plain token; a bare separator
	// (a space before a differently-run rest) still gets the restyle.
	const hasContinuation = /^[ \t]*\S/.test(tail);
	const styled = namePaint && !hasContinuation ? namePaint(title) : title;
	return `${open}${styled}${tail}${close}${rest}`;
}

/** Cut `count` visible columns of plain trailing pad spaces off the end. */
function shedTrailingPad(line: string, count: number): string {
	let end = line.length;
	for (let cut = 0; cut < count && end > 0 && line[end - 1] === " "; cut++) end--;
	return line.slice(0, end);
}

/** Drop leading pad cells, re-anchoring the escape sequences that ran around them. */
function trimLead(line: string): string {
	let open = "";
	let index = 0;
	for (;;) {
		if (line[index] === " ") {
			index++;
			continue;
		}
		const escape = escapeAt(line, index);
		if (escape) {
			open += escape;
			index += escape.length;
			continue;
		}
		return open + line.slice(index);
	}
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
	while (end < line.length) {
		const escape = escapeAt(line, end);
		if (!escape) break;
		end += escape.length;
	}
	return end;
}

/** The escape sequence at `position` — an SGR color code or an OSC-8 wrapper — or "" when none. */
function escapeAt(line: string, position: number): string {
	if (!line.startsWith("\x1b", position)) return "";
	const sgr = /^\x1b\[[0-9;]*m/.exec(line.slice(position));
	if (sgr) return sgr[0];
	// The OSC-8 hyperlink carries the URL between `\x1b]8;;` and the ST terminator.
	const osc = /^\x1b\]8;;[^\x1b]*\x1b\\/.exec(line.slice(position));
	return osc?.[0] ?? "";
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
