import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { TOOL_PICK } from "../../../shared/glyphs.ts";

/**
 * Frames a tool component as a tree hanging from its status glyph: one shared
 * margin column aligns the block with the editor inset, the glyph rides the
 * header row with the tool-name token rewritten to PascalCase in place, and a
 * dim rule runs below the icon down every content row, so the call header and
 * its result body hang from the same stem:
 *
 *   ⯁ Edit ~/project/package.json
 *   │ 1 {
 *   │ "name": "@couralabs/pi-adhd",
 *
 * Blank rows at either edge of the inner's render — Box renderers' padding
 * rows, a shell result's leading spacer — are trimmed, so the block starts at
 * the header and ends at its last visible row. Blank rows between content keep
 * their rule.
 *
 * The header is the first remaining row. Renderers whose header leads with
 * their shell prompt instead of the tool name (`$ npm test`, `PS> npm test`)
 * get the prompt token rewritten to the PascalCase name; renderers leading
 * with something else — a classification tag — get the icon only.
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
	private name = "";

	set(
		inner: Component,
		paint: ((text: string) => string) | undefined,
		name: string,
		namePaint?: (text: string) => string,
		rulePaint?: (text: string) => string,
	): void {
		this.inner = inner;
		this.paint = paint;
		this.name = name;
		this.namePaint = namePaint;
		this.rulePaint = rulePaint;
	}

	render(width: number): string[] {
		const contentWidth = width - CONTENT_COLUMN;
		// Below four columns neither the header (`margin + icon + body`) nor a
		// content row fits; render nothing rather than an over-wide line.
		if (contentWidth <= 0) return [];
		const lines = trimBlankEdges(this.inner?.render(contentWidth) ?? []);
		if (lines.length === 0) return lines;
		const rule = this.rulePaint ? this.rulePaint(RULE_GLYPH) : RULE_GLYPH;
		// Copied so the header splice below never mutates the inner's cached array.
		const rows = lines.map((line) => `${FRAME_MARGIN}${rule} ${line}`);
		if (!this.paint) return rows;
		// The header is the first row; its body re-anchors after the icon, so the
		// row's own lead pad goes and the name splice runs on the trimmed text.
		// The inner already clamped to `contentWidth`, so the body fits — the
		// truncate is a final guard against a renderer handing back an overlong
		// line, which pi-tui treats as fatal.
		const body = truncateToWidth(
			spliceName(trimLead(lines[0]), this.name, this.namePaint),
			contentWidth,
		);
		rows[0] = `${FRAME_MARGIN}${this.paint(TOOL_PICK)} ${body}`;
		return rows;
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}

/** Drop blank rows at either edge; interior blanks keep their rule. */
function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start].trim() === "") start++;
	while (end > start && lines[end - 1].trim() === "") end--;
	return lines.slice(start, end);
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
