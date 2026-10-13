const BLOCK_END =
	/<\/(?:address|article|aside|blockquote|div|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)>/gi;
const BREAK = /<br\s*\/?>/gi;
const HEAD = /<head\b[^>]*>[\s\S]*?<\/head>/gi;
const SCRIPT_OR_STYLE = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAG = /<[^>]+>/g;

const ENTITIES: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
		if (code[0] === "#") {
			const hex = code[1]?.toLowerCase() === "x";
			const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
			return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
		}
		return ENTITIES[code.toLowerCase()] ?? entity;
	});
}

export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(COMMENTS, "")
			.replace(HEAD, "")
			.replace(SCRIPT_OR_STYLE, "")
			.replace(BREAK, "\n")
			.replace(BLOCK_END, "\n")
			.replace(TAG, " "),
	)
		.replace(/\r/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
