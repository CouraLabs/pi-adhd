import { describe, expect, it } from "vitest";
import { parseThinkingLevel, thinkingLevelError } from "../../../../extensions/tools/spawn/config/thinking-level.ts";

describe("parseThinkingLevel", () => {
	it("accepts every valid level", () => {
		for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
			expect(parseThinkingLevel(level)).toBe(level);
		}
	});

	it("rejects unknown and non-string values", () => {
		expect(parseThinkingLevel("HIGH")).toBeUndefined();
		expect(parseThinkingLevel("ultra")).toBeUndefined();
		expect(parseThinkingLevel(2)).toBeUndefined();
		expect(parseThinkingLevel(null)).toBeUndefined();
		expect(parseThinkingLevel(undefined)).toBeUndefined();
	});
});

describe("thinkingLevelError", () => {
	it("quotes string values", () => {
		expect(thinkingLevelError("ultra")).toBe(
			'Invalid thinking level "ultra". Valid levels: off, minimal, low, medium, high, xhigh, max.',
		);
	});

	it("formats numbers and booleans directly", () => {
		expect(thinkingLevelError(5)).toContain("Invalid thinking level 5.");
		expect(thinkingLevelError(true)).toContain("Invalid thinking level true.");
	});

	it("formats null", () => {
		expect(thinkingLevelError(null)).toContain("Invalid thinking level null.");
	});

	it("describes objects by type", () => {
		expect(thinkingLevelError({ level: "high" })).toContain("Invalid thinking level of type object.");
		expect(thinkingLevelError(undefined)).toContain("Invalid thinking level of type undefined.");
	});
});
