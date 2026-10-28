import { describe, expect, it } from "vitest";
import { highlightMarkdownLines } from "../../../extensions/ui/editor/markdown-highlight.ts";

const stylesAt = (highlight: { spans: Array<{ start: number; end: number; style: unknown }> }, index: number) => {
	let style: unknown;
	for (const span of highlight.spans) {
		if (span.start <= index && index < span.end) style = span.style;
	}
	return style;
};

describe("highlightMarkdownLines", () => {
	it("styles headings", () => {
		const [heading] = highlightMarkdownLines(["# Title"]);
		expect(stylesAt(heading, 0)).toMatchObject({ fg: "mdHeading", bold: true });
	});

	it("styles inline code, bold, and links", () => {
		const [line] = highlightMarkdownLines(["run `npm i` for **speed** see [docs](https://x.dev)"]);
		expect(stylesAt(line, 5)).toMatchObject({ fg: "mdCode" });
		expect(stylesAt(line, 20)).toMatchObject({ bold: true });
		expect(stylesAt(line, 34)).toMatchObject({ fg: "mdLink", underline: true });
		expect(stylesAt(line, 41)).toMatchObject({ fg: "mdLinkUrl" });
	});

	it("styles list bullets and keeps content plain", () => {
		const [line] = highlightMarkdownLines(["- item one"]);
		expect(stylesAt(line, 0)).toMatchObject({ fg: "mdListBullet" });
		expect(stylesAt(line, 5)).toBeUndefined();
	});

	it("toggles fenced code blocks across lines", () => {
		const highlights = highlightMarkdownLines(["```ts", "const x = 1", "```", "plain"]);
		expect(stylesAt(highlights[0], 0)).toMatchObject({ fg: "mdCodeBlockBorder" });
		expect(stylesAt(highlights[1], 0)).toMatchObject({ fg: "mdCodeBlock" });
		expect(stylesAt(highlights[2], 0)).toMatchObject({ fg: "mdCodeBlockBorder" });
		expect(stylesAt(highlights[3], 0)).toBeUndefined();
	});

	it("styles blockquotes with border and text", () => {
		const [line] = highlightMarkdownLines(["> quoted words"]);
		expect(stylesAt(line, 0)).toMatchObject({ fg: "mdQuoteBorder" });
		expect(stylesAt(line, 4)).toMatchObject({ fg: "mdQuote" });
	});

	it("styles image objects distinctly from plain text", () => {
		const [line] = highlightMarkdownLines(["look [Image #1] here"]);
		expect(stylesAt(line, 6)).toMatchObject({ fg: "accent", bold: true });
		expect(stylesAt(line, 2)).toBeUndefined();
	});

	it("styles unterminated bold to end of line", () => {
		const [line] = highlightMarkdownLines(["start **bolding"]);
		expect(stylesAt(line, 9)).toMatchObject({ bold: true });
	});

	it("does not italicize snake_case underscores", () => {
		const [line] = highlightMarkdownLines(["foo_bar_baz"]);
		expect(stylesAt(line, 5)).toBeUndefined();
	});

	it("styles horizontal rules", () => {
		const [line] = highlightMarkdownLines(["---"]);
		expect(stylesAt(line, 0)).toMatchObject({ fg: "mdHr" });
	});
});
