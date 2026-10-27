import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { stripStyling } from "../../../shared/format.ts";
import { TOOL_PICK } from "../../../shared/glyphs.ts";

const FRAME_MARGIN = " ";

const RULE_GLYPH = "│";

const END_RULE_GLYPH = "└";

const CONTENT_COLUMN = 3;

const PROMPT_PATTERN = /^(?:\$|PS>)(?=\s|$)/;

export class ToolFrame implements Component {
	inner: Component | undefined;

	private paint: ((text: string) => string) | undefined;

	private namePaint: ((text: string) => string) | undefined;

	private rulePaint: ((text: string) => string) | undefined;

	private restyle: ((row: string) => string) | undefined;

	private summary: string | undefined;

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

		if (contentWidth <= 0) return [];
		const lines = collapseEdgeGaps(trimBlankEdges(this.inner?.render(contentWidth) ?? []));
		const rule = this.rulePaint ? this.rulePaint(RULE_GLYPH) : RULE_GLYPH;
		const endRule = this.rulePaint ? this.rulePaint(END_RULE_GLYPH) : END_RULE_GLYPH;
		if (lines.length === 0) {

			if (this.paint) {
				const prefix = `${FRAME_MARGIN}${this.paint(TOOL_PICK)} `;
				return [prefix + truncateToWidth(pascalCase(this.name), width - visibleWidth(prefix))];
			}

			return this.summary ? [`${FRAME_MARGIN}${endRule} ${this.summary}`] : [];
		}

		const shaped =
			this.restyle && lines.length > 0
				? lines.map((line, index) => (index === 0 && this.paint ? line : this.restyle!(line)))
				: lines;

		const closesTree = !this.paint;
		const rows = shaped.map((line, index) =>
			closesTree && index === shaped.length - 1
				? `${FRAME_MARGIN}${endRule} ${line}`
				: `${FRAME_MARGIN}${rule} ${line}`,
		);
		if (!this.paint) return rows;

		const headerLead = `${FRAME_MARGIN}${this.paint(TOOL_PICK)} `;

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

function isBlankRow(line: string): boolean {
	return stripStyling(line).trim() === "";
}

function trimBlankEdges(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && isBlankRow(lines[start])) start++;
	while (end > start && isBlankRow(lines[end - 1])) end--;
	return lines.slice(start, end);
}

function collapseEdgeGaps(lines: string[]): string[] {
	if (lines.length <= 2) return lines;
	const last = lines.length - 1;

	let first = 1;
	while (first < last && isBlankRow(lines[first])) first++;

	let tail = last - 1;
	while (tail > first && isBlankRow(lines[tail])) tail--;
	const out = [lines[0]];
	for (let index = first; index <= tail; index++) out.push(lines[index]);
	out.push(lines[last]);
	return out;
}

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

	const hasContinuation = /^[ \t]*\S/.test(tail);
	const styled = namePaint && !hasContinuation ? namePaint(title) : title;
	return `${open}${styled}${tail}${close}${rest}`;
}

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

function wordPrefix(text: string): string {
	return /^\w+/.exec(text)?.[0] ?? "";
}

function normalizeToken(text: string): string {
	return text.replace(/[-_.]/g, "").toLowerCase();
}

function plainEndFrom(line: string, position: number): number {
	let end = position;
	while (end < line.length && line[end] !== "\x1b") end++;
	return end;
}

function escapeEndAfter(line: string, position: number): number {
	let end = position;
	while (end < line.length) {
		const escape = escapeAt(line, end);
		if (!escape) break;
		end += escape.length;
	}
	return end;
}

function escapeAt(line: string, position: number): string {
	if (!line.startsWith("\x1b", position)) return "";
	const sgr = /^\x1b\[[0-9;]*m/.exec(line.slice(position));
	if (sgr) return sgr[0];

	const osc = /^\x1b]8;;[^\x1b]*\x1b\\/.exec(line.slice(position));
	return osc?.[0] ?? "";
}

export function pascalCase(name: string): string {
	return name
		.split(/[-_.\s]+|[a-z](?=[A-Z0-9])/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}
