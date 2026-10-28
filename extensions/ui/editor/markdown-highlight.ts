import type { ThemeStyle } from "@earendil-works/pi-coding-agent";

export interface HighlightSpan {

	start: number;

	end: number;

	style: ThemeStyle;
}

export interface LineHighlight {

	spans: HighlightSpan[];

	fenceOpen: boolean;
}

const FENCE_PATTERN = /^\s{0,3}(```|~~~)/;
const HEADING_LINE_PATTERN = /^#{1,6}\s.*$/;
const HR_PATTERN = /^\s{0,3}((-{3,}|\*{3,}|_{3,}))\s*$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?/;
const LIST_PATTERN = /^(\s*)([-*+]|\d{1,9}[.)])(\s)/;

const HEADING_STYLE: ThemeStyle = { fg: "mdHeading", bold: true };
const HR_STYLE: ThemeStyle = { fg: "mdHr" };
const FENCE_STYLE: ThemeStyle = { fg: "mdCodeBlockBorder" };
const CODE_BLOCK_STYLE: ThemeStyle = { fg: "mdCodeBlock" };
const QUOTE_BORDER_STYLE: ThemeStyle = { fg: "mdQuoteBorder" };
const QUOTE_STYLE: ThemeStyle = { fg: "mdQuote" };
const LIST_BULLET_STYLE: ThemeStyle = { fg: "mdListBullet" };
const CODE_STYLE: ThemeStyle = { fg: "mdCode" };
const BOLD_STYLE: ThemeStyle = { bold: true };
const ITALIC_STYLE: ThemeStyle = { italic: true };
const STRIKE_STYLE: ThemeStyle = { strikethrough: true };
const LINK_STYLE: ThemeStyle = { fg: "mdLink", underline: true };
const LINK_URL_STYLE: ThemeStyle = { fg: "mdLinkUrl" };
const IMAGE_OBJECT_STYLE: ThemeStyle = { fg: "accent", bold: true };
const PASTE_MARKER_STYLE: ThemeStyle = { fg: "dim", italic: true };

interface InlineRule {

	pattern: RegExp;

	spans: (match: RegExpExecArray) => HighlightSpan[];
}

const INLINE_RULES: InlineRule[] = [
	{
		pattern: /\[Image #\d+\]/y,
		spans: (match) => [span(match, IMAGE_OBJECT_STYLE)],
	},
	{
		pattern: /\[paste #\d+( \+\d+ lines| \d+ chars)?\]/y,
		spans: (match) => [span(match, PASTE_MARKER_STYLE)],
	},
	{
		pattern: /`+[^`\n]*`+/y,
		spans: (match) => [span(match, CODE_STYLE)],
	},
	{
		pattern: /\[[^\]\n]*\]\([^)\n]*\)/y,
		spans: (match) => {
			const urlStart = match.index + match[0].indexOf("](") + 1;
			return [
				{ start: match.index, end: urlStart, style: LINK_STYLE },
				{ start: urlStart, end: match.index + match[0].length, style: LINK_URL_STYLE },
			];
		},
	},
	{
		pattern: /<https?:\/\/[^>\s]+>/y,
		spans: (match) => [span(match, LINK_URL_STYLE)],
	},
	{
		pattern: /https?:\/\/[^\s)\]>]+/y,
		spans: (match) => {
			let end = match.index + match[0].length;
			while (end > match.index && /[.,;:!?)"']/.test(match[0][end - match.index - 1])) end--;
			return [{ start: match.index, end, style: LINK_URL_STYLE }];
		},
	},
	{
		pattern: /\*\*[^*\n]+\*\*/y,
		spans: (match) => [span(match, BOLD_STYLE)],
	},
	{
		pattern: /~~[^~\n]+~~/y,
		spans: (match) => [span(match, STRIKE_STYLE)],
	},
	{
		pattern: /\*[^*\s][^*\n]*\*/y,
		spans: (match) => [span(match, ITALIC_STYLE)],
	},
];

function span(match: RegExpExecArray, style: ThemeStyle): HighlightSpan {
	return { start: match.index, end: match.index + match[0].length, style };
}

function underscoreItalicMatches(text: string, index: number): boolean {
	if (index > 0 && /[\w_]/.test(text[index - 1])) return false;
	const rest = text.slice(index);
	const match = /^_[^_\s][^_\n]*_/.exec(rest);
	if (!match) return false;
	const after = rest.slice(match[0].length);
	return !/[\w_]/.test(after.charAt(0));
}

function tokenizeInline(text: string, offset: number): HighlightSpan[] {
	const spans: HighlightSpan[] = [];
	let index = 0;
	while (index < text.length) {
		const matched = applyInlineRules(text, index, offset, spans);
		if (matched > 0) {
			index += matched;
			continue;
		}
		if (openEndedMarker(text, index, offset, "**", BOLD_STYLE, spans)
			|| openEndedMarker(text, index, offset, "~~", STRIKE_STYLE, spans)) {
			index = text.length;
			continue;
		}
		if (text[index] === "*" && italicStar(text, index, offset, spans)) {
			const close = text.indexOf("*", index + 1);
			index = close + 1;
			continue;
		}
		if (text[index] === "_" && underscoreItalicMatches(text, index)) {
			const close = text.indexOf("_", index + 1);
			spans.push({ start: offset + index, end: offset + close + 1, style: ITALIC_STYLE });
			index = close + 1;
			continue;
		}
		index++;
	}
	return spans;
}

function applyInlineRules(text: string, index: number, offset: number, spans: HighlightSpan[]): number {
	for (const rule of INLINE_RULES) {
		rule.pattern.lastIndex = index;
		const match = rule.pattern.exec(text);
		if (!match || match.index !== index) continue;
		for (const candidate of rule.spans(match)) {
			spans.push({ start: candidate.start + offset, end: candidate.end + offset, style: candidate.style });
		}
		return match[0].length;
	}
	return 0;
}

function openEndedMarker(
	text: string,
	index: number,
	offset: number,
	marker: string,
	style: ThemeStyle,
	spans: HighlightSpan[],
): boolean {
	if (!text.startsWith(marker, index) || index + marker.length >= text.length) return false;
	spans.push({ start: offset + index, end: offset + text.length, style });
	return true;
}

function italicStar(text: string, index: number, offset: number, spans: HighlightSpan[]): boolean {
	const close = text.indexOf("*", index + 1);
	if (close === -1 || close === index + 1) return false;
	spans.push({ start: offset + index, end: offset + close + 1, style: ITALIC_STYLE });
	return true;
}

export function highlightMarkdownLines(lines: readonly string[]): LineHighlight[] {
	const highlights: LineHighlight[] = [];
	let inFence = false;
	for (const line of lines) {
		const highlight = highlightLine(line, inFence);
		inFence = highlight.fenceOpen;
		highlights.push(highlight);
	}
	return highlights;
}

function highlightLine(line: string, inFence: boolean): LineHighlight {
	if (inFence) {
		const closes = FENCE_PATTERN.test(line);
		return {
			spans: [{ start: 0, end: line.length, style: closes ? FENCE_STYLE : CODE_BLOCK_STYLE }],
			fenceOpen: !closes,
		};
	}
	if (FENCE_PATTERN.test(line)) {
		return { spans: [{ start: 0, end: line.length, style: FENCE_STYLE }], fenceOpen: true };
	}
	if (HR_PATTERN.test(line)) {
		return { spans: [{ start: 0, end: line.length, style: HR_STYLE }], fenceOpen: false };
	}
	if (HEADING_LINE_PATTERN.test(line)) {
		return { spans: [{ start: 0, end: line.length, style: HEADING_STYLE }], fenceOpen: false };
	}
	const spans: HighlightSpan[] = [];
	let offset = 0;
	const quote = QUOTE_PATTERN.exec(line);
	if (quote) {
		spans.push({ start: 0, end: quote[0].length, style: QUOTE_BORDER_STYLE });
		offset = quote[0].length;
		spans.push({ start: offset, end: line.length, style: QUOTE_STYLE });
	}
	const content = line.slice(offset);
	const list = LIST_PATTERN.exec(content);
	if (list) {
		const bulletLength = list[1].length + list[2].length + 1;
		spans.push({ start: offset, end: offset + bulletLength, style: LIST_BULLET_STYLE });
		offset += bulletLength;
	}
	spans.push(...tokenizeInline(line.slice(offset), offset));
	return { spans, fenceOpen: false };
}
