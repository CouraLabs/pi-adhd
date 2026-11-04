import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { wordWrapLine, type TextChunk } from "../../../extensions/ui/editor/vendored-word-wrap.ts";
import { decodePrintableKey } from "../../../extensions/ui/editor/vendored-printable-key.ts";

function checkInvariants(line: string, chunks: TextChunk[]): void {
	let cursor = 0;
	for (const chunk of chunks) {
		expect(line.slice(chunk.startIndex, chunk.endIndex)).toBe(chunk.text);
		expect(chunk.startIndex).toBe(cursor);
		cursor = chunk.endIndex;
	}
	expect(cursor).toBe(line.length);
}

describe("wordWrapLine", () => {
	it("returns a single empty chunk for an empty line", () => {
		expect(wordWrapLine("", 10)).toEqual([{ text: "", startIndex: 0, endIndex: 0 }]);
	});

	it("returns a single empty chunk when maxWidth <= 0", () => {
		expect(wordWrapLine("hello", 0)).toEqual([{ text: "", startIndex: 0, endIndex: 0 }]);
		expect(wordWrapLine("hello", -3)).toEqual([{ text: "", startIndex: 0, endIndex: 0 }]);
	});

	it("keeps a short line as one chunk", () => {
		const chunks = wordWrapLine("hello", 10);
		expect(chunks).toEqual([{ text: "hello", startIndex: 0, endIndex: 5 }]);
	});

	it("wraps at whitespace", () => {
		const chunks = wordWrapLine("hello world", 8);
		expect(chunks.length).toBe(2);
		expect(chunks[0].text).toBe("hello ");
		for (const chunk of chunks) {
			expect(visibleWidth(chunk.text)).toBeLessThanOrEqual(8);
		}
		checkInvariants("hello world", chunks);
	});

	it("force-breaks a word longer than maxWidth", () => {
		const line = "abcdefghij";
		const chunks = wordWrapLine(line, 4);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(visibleWidth(chunk.text)).toBeLessThanOrEqual(4);
		}
		checkInvariants(line, chunks);
	});

	it("breaks between adjacent CJK characters", () => {
		const line = "漢字漢字漢字";
		const chunks = wordWrapLine(line, 4);
		expect(chunks.length).toBe(3);
		expect(chunks.map((c) => c.text)).toEqual(["漢字", "漢字", "漢字"]);
		checkInvariants(line, chunks);
	});

	it("sub-chunks a preSegmented atomic segment wider than maxWidth", () => {
		const line = "[paste #1 +5 lines]";
		const segment: Intl.SegmentData = { segment: line, index: 0, input: line };
		const chunks = wordWrapLine(line, 8, [segment]);
		expect(chunks.length).toBeGreaterThan(1);
		let joined = "";
		for (const chunk of chunks) {
			joined += chunk.text;
		}
		expect(joined).toBe(line);
		checkInvariants(line, chunks);
	});
});

describe("decodePrintableKey", () => {
	it("decodes shift+a via modifyOtherKeys", () => {
		expect(decodePrintableKey("\x1b[27;2;97~")).toBe("a");
	});

	it("decodes unmodified a via modifyOtherKeys", () => {
		expect(decodePrintableKey("\x1b[27;1;97~")).toBe("a");
	});

	it("returns undefined for ctrl+a via modifyOtherKeys", () => {
		expect(decodePrintableKey("\x1b[27;5;97~")).toBeUndefined();
	});
});
