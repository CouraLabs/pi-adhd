import { describe, expect, it } from "vitest";
import {
	comparePositions,
	deleteTextRange,
	normalizeSelection,
	selectedColumns,
	selectionCoversText,
	selectionText,
} from "../../../extensions/ui/editor/selection.ts";

describe("comparePositions", () => {
	it("orders by line then column", () => {
		expect(comparePositions({ line: 0, col: 5 }, { line: 1, col: 0 })).toBeLessThan(0);
		expect(comparePositions({ line: 1, col: 0 }, { line: 0, col: 9 })).toBeGreaterThan(0);
		expect(comparePositions({ line: 2, col: 3 }, { line: 2, col: 3 })).toBe(0);
	});
});

describe("normalizeSelection", () => {
	it("returns start/end regardless of direction", () => {
		const forward = normalizeSelection({ line: 0, col: 2 }, { line: 1, col: 1 });
		expect(forward).toEqual({ start: { line: 0, col: 2 }, end: { line: 1, col: 1 } });
		const backward = normalizeSelection({ line: 1, col: 1 }, { line: 0, col: 2 });
		expect(backward).toEqual({ start: { line: 0, col: 2 }, end: { line: 1, col: 1 } });
	});
});

describe("selectionCoversText", () => {
	it("is false when collapsed", () => {
		expect(selectionCoversText({ start: { line: 0, col: 3 }, end: { line: 0, col: 3 } })).toBe(false);
		expect(selectionCoversText({ start: { line: 0, col: 0 }, end: { line: 0, col: 1 } })).toBe(true);
	});
});

describe("selectedColumns", () => {
	it("clamps per line", () => {
		const range = { start: { line: 1, col: 2 }, end: { line: 3, col: 4 } };
		expect(selectedColumns(range, 0, 10)).toBeUndefined();
		expect(selectedColumns(range, 1, 10)).toEqual({ from: 2, to: 10 });
		expect(selectedColumns(range, 2, 10)).toEqual({ from: 0, to: 10 });
		expect(selectedColumns(range, 3, 10)).toEqual({ from: 0, to: 4 });
		expect(selectedColumns(range, 4, 10)).toBeUndefined();
	});
});

describe("selectionText", () => {
	it("extracts across lines including newlines", () => {
		const lines = ["alpha", "beta", "gamma"];
		expect(selectionText(lines, { start: { line: 0, col: 2 }, end: { line: 2, col: 3 } })).toBe("pha\nbeta\ngam");
	});

	it("includes the newline when the selection ends at column 0", () => {
		const lines = ["alpha", "beta"];
		expect(selectionText(lines, { start: { line: 0, col: 3 }, end: { line: 1, col: 0 } })).toBe("ha\n");
	});
});

describe("deleteTextRange", () => {
	it("deletes within one line", () => {
		const result = deleteTextRange(["hello world"], { start: { line: 0, col: 5 }, end: { line: 0, col: 11 } });
		expect(result.lines).toEqual(["hello"]);
		expect(result.cursor).toEqual({ line: 0, col: 5 });
	});

	it("merges across lines", () => {
		const result = deleteTextRange(["one", "two", "three"], { start: { line: 0, col: 2 }, end: { line: 2, col: 1 } });
		expect(result.lines).toEqual(["onhree"]);
		expect(result.cursor).toEqual({ line: 0, col: 2 });
	});
});
