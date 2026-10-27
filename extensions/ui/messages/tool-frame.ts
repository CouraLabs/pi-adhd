import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripStyling } from "../../../shared/format.ts";
import { TOOL_PICK } from "../../../shared/glyphs.ts";

/**
 * Frames a tool component as a tree hanging from its status glyph: one shared
 * margin column aligns the block with the editor inset, the glyph rides the
 * header row with the tool-name token rewritten to PascalCase in place, and a
 * dim rule runs below the icon down every content row, so the call header and
 * its result body hang from the same stem:
 *
 *   ┌⯁ Edit ~/project/package.json
 *   │ 1 {
 *   │ "name": "@couralabs/pi-adhd",
 *
 * Blank rows at either edge of the inner's render — Box renderers' padding
 * rows, a shell result's leading spacer — are trimmed, and blank runs hugging
 * the header or the final row collapse too (a renderer's Spacer between its
 * header and body, its newline before a timer line), so the rule runs
 * unbroken from the glyph down the last visible row, which closes with `└`.
 * Deeper interior blanks are content and keep their rule. A result body that
 * renders nothing shows its muted summary row instead, so every call keeps
 * at least two rows on screen.
 *
 * The header is the first remaining row. Renderers whose header leads with
 * their shell prompt instead of the tool name (`$ npm test`, `PS> npm test`)
 * get the prompt token rewritten to the PascalCase name; renderers leading
 * with something else — a classification tag — get the icon only. A header
 * longer than the width truncates silently; an optional timer right-aligns
 * in the freed columns.
 *
 * In plain mode (`paint` undefined) — result bodies under the call header —
 * rows take the margin and the rule but nothing else changes. Never mutating:
 * the inner caches its rendered array between frames, so only a copied array
 * leaves this component.
 */

/** Shared left margin; aligns the block with the editor's one-column inset. */
const FRAME_MARGIN = " ";
/** Dim rule drawn below the icon on every content row. */
const RULE_GLYPH = "│";
/** Closing corner on the frame's final row — the tree ends here. */
const END_RULE_GLYPH = "└";
/** Columns a row spends left of its content: margin, rule, and one gap. */
const CONTENT_COLUMN = 3;

/** Shell prompts that stand in for the tool name on a header row. */
const PROMPT_PATTERN = /^(?:\$|PS>)(?=\s|$)/;

export class ToolFrame implements Component {
	inner: Component | undefined;
	/** Paint for the status icon; `undefined` switches the frame to plain mode. */
	private paint: ((text: string) => string) | undefined;
	/** Restyler for the spliced tool-name token; the splice keeps pi's styling when absent. */
	private namePaint: ((text: string) => string) | undefined;
	/** Paint for the dim rule below the icon. */
	private rulePaint: ((text: string) => string) | undefined;
	/** Optional per-row restyle (diff syntax colors); applied after the header row. */
	private restyle: ((row: string) => string) | undefined;
	/** Muted summary row shown when the result body renders nothing (collapsed bodies, empty output). */
	private summary: string | undefined;
	/** Right-aligned timer on the header row; replaces the old truncation ellipsis. */
	private timer: string | undefined;
	private name = "";

	set(
		inner: Component,
		paint: ((text: string) => string) | undefined,
		name: string,
		namePaint?: (text: string) => string,
		rulePaint?: (text: string) => string,
		restyle?: (row: string) => string,
		summary?: string,
		timer?: string,
	): void {
		this.inner = inner;
		this.paint = paint;
		this.name = name;
		this.namePaint = namePaint;
		this.rulePaint = rulePaint;
		this.restyle = restyle;
		this.summary = summary;
		this.timer = timer;
	}

	render(width: number): string[] {
		const contentWidth = width - CONTENT_COLUMN;
		// Below four columns neither the header (`margin + icon + body`) nor a
		// content row fits; render nothing rather than an over-wide line.
		if (contentWidth <= 0) return [];
		const lines = collapseEdgeGaps(trimBlankEdges(this.inner?.render(contentWidth) ?? []));
		const rule = this.rulePaint ? this.rulePaint(RULE_GLYPH) : RULE_GLYPH;
		const endRule = this.rulePaint ? this.rulePaint(END_RULE_GLYPH) : END_RULE_GLYPH;
		if (lines.length === 0) {
			// While arguments stream, a renderer may have nothing to draw yet — but
			// the call should still announce itself: emit the bare header row so the
			// streaming tool shows up the moment its first argument delta lands.
			if (this.paint) {
				const prefix = `${FRAME_MARGIN}${this.paint(TOOL_PICK)} `;
				return [prefix + truncateToWidth(pascalCase(this.name), width - visibleWidth(prefix))];
			}
			// A settled body with nothing to show (a collapsed `read`, `write` on
			// success) still renders its summary row, so every tool keeps at least
			// two rows on screen and the tree closes with `└`.
			return this.summary ? [`${FRAME_MARGIN}${endRule} ${this.summary}`] : [];
		}
		// Restyle runs on the bare rows — the diff parser reads the renderer's own
		// line shape, before any frame prefix lands. The header row keeps its
		// renderer styling in paint mode; plain-mode rows restyle wholesale (the
		// styler leaves non-diff rows untouched).
		const shaped =
			this.restyle && lines.length > 0
				? lines.map((line, index) => (index === 0 && this.paint ? line : this.restyle!(line)))
				: lines;
		// Copied so the header splice below never mutates the inner's cached array.
		// The result frame's final stem row closes the tree with `└` — the result
		// is always the call's last component — while a call frame keeps `│`
		// throughout: its stem continues into the result rows that follow a
		// multi-row call (edit's diff hangs below its header, so a `└` there
		// would close the tree before the result).
		const closesTree = !this.paint;
		const rows = shaped.map((line, index) =>
			closesTree && index === shaped.length - 1
				? `${FRAME_MARGIN}${endRule} ${line}`
				: `${FRAME_MARGIN}${rule} ${line}`,
		);
		if (!this.paint) return rows;
		// The header is the first row; its body re-anchors after the icon, so the
		// row's own lead pad goes and the name splice runs on the trimmed text.
		// The two-column glyph costs a column over the plain-mode rows, so the
		// body truncates against the header's own lead width — the truncate is a
		// guard against a renderer handing back an overlong line, which pi-tui
		// treats as fatal.
		const headerLead = `${FRAME_MARGIN}${this.paint(TOOL_PICK)} `;
		// The header truncates silently — no ellipsis marker; the row's spare
		// columns carry a right-aligned timer instead when one is set. Without a
		// timer the body simply clips at the edge, unpadded.
		const leadWidth = visibleWidth(headerLead);
		const timerWidth = this.timer === undefined ? 0 : visibleWidth(this.timer) + 1;
		const bodyWidth = width - leadWidth - timerWidth;
		const showTimer = timerWidth > 0 && bodyWidth >= 1;
		const body = truncateToWidth(
			spliceName(trimLead(lines[0]), this.name, this.namePaint),
			Math.max(1, showTimer ? bodyWidth : width - leadWidth),
			"",
			showTimer,
		);
		rows[0] = headerLead + body + (showTimer ? ` ${this.timer}` : "");
		return rows;
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}

/** A row carrying only invisible styling and whitespace renders as nothing. */
function isBlankRow(line: string): boolean {
	return stripStyling(line).trim() === "";
}

/** Drop blank rows at either edge; interior blanks keep their rule. */
function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlankRow(lines[start])) start++;
	while (end > start && isBlankRow(lines[end - 1])) end--;
	return lines.slice(start, end);
}

/**
 * Drop the blank runs hugging the header and the final row — a renderer's
 * Spacer between its header and its body, or its newline before a timer line,
 * read as dead space under the frame's rule. Interior blank runs deeper in
 * the body are content and survive.
 */
function collapseEdgeGaps(lines: string[]): string[] {
	if (lines.length <= 2) return lines;
	const last = lines.length - 1;
	// First visible row after the header.
	let first = 1;
	while (first < last && isBlankRow(lines[first])) first++;
	// Start of the visible run before the final row.
	let tail = last - 1;
	while (tail > first && isBlankRow(lines[tail])) tail--;
	const out = [lines[0]];
	for (let index = first; index <= tail; index++) out.push(lines[index]);
	out.push(lines[last]);
	return out;
}

/**
 * Rewrite a tool-name token at the start of a line to PascalCase, restyled by
 * `namePaint` when given. The restyle wraps only the name token; the tail of
 * the run (`read skill`) and everything after keep the renderer's own styling.
 *
 * Line shape: `[open codes][plain][close codes][rest]`. The plain run may be
 * exactly the name (`read`), start with it and continue inside the same
 * style run (`read skill`), or lead with a shell prompt standing in for the
 * name (`$ npm test`). Nothing is rewritten when the run's first word is not
 * the tool name or a prompt, or when the match runs into an identifier
 * boundary (`read` vs `readme`). Separators are ignored when matching, so a
 * renderer's own PascalCase output (`JobKill`) still matches the `job-kill`
 * name and is left already correct.
 */
function spliceName(line: string, name: string, namePaint?: (text: string) => string): string {
	const openEnd = escapeEndAfter(line, 0);
	const open = line.slice(0, openEnd);

	const plainEnd = plainEndFrom(line, openEnd);
	const plain = line.slice(openEnd, plainEnd);
	const word = wordPrefix(plain);
	const wordMatches = word !== "" && normalizeToken(word) === normalizeToken(name);
	const prompt = wordMatches ? "" : PROMPT_PATTERN.exec(plain)?.[0] ?? "";
	if (!wordMatches && !prompt) return line;
	const token = wordMatches ? word : prompt;

	const closeEnd = escapeEndAfter(line, plainEnd);
	const close = line.slice(plainEnd, closeEnd);
	const tail = plain.slice(token.length);
	const rest = line.slice(closeEnd);
	const title = pascalCase(name);
	// A tail that starts a real word (`read skill`, `Bash npm test`) belongs to
	// the renderer's original run, so the restyle wraps only the plain token; a
	// bare separator (a space before a differently-run rest) still gets the
	// restyle.
	const hasContinuation = /^[ \t]*\S/.test(tail);
	const styled = namePaint && !hasContinuation ? namePaint(title) : title;
	return `${open}${styled}${tail}${close}${rest}`;
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
	const osc = /^\x1b]8;;[^\x1b]*\x1b\\/.exec(line.slice(position));
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
