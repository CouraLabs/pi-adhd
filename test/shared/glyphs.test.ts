import { describe, expect, it } from "vitest";
import * as glyphs from "../../shared/glyphs.ts";

describe("glyphs", () => {
	it("exports a non-empty string for every simple constant", () => {
		for (const [key, value] of Object.entries(glyphs)) {
			if (key === "THINKING_LEVELS" || key === "GAUGE_GLYPHS") continue;
			expect(value, key).toBeTypeOf("string");
			expect(value, key).not.toHaveLength(0);
		}
	});

	it("exports the expected set of simple constants", () => {
		const keys = Object.keys(glyphs).filter((key) => key !== "THINKING_LEVELS" && key !== "GAUGE_GLYPHS");
		expect(keys.sort()).toEqual([
			"BOX_BOTTOM_LEFT",
			"BOX_BOTTOM_RIGHT",
			"BOX_HORIZONTAL",
			"BOX_TOP_LEFT",
			"BOX_TOP_RIGHT",
			"BOX_VERTICAL",
			"CACHE_GLYPH",
			"CONTEXT_GLYPH",
			"ELLIPSIS",
			"INPUT",
			"MODE_CLAUDE",
			"MODE_CUSTOM",
			"MODE_PI",
			"MODE_WORK",
			"OUTPUT",
			"POMODORO_BREAK",
			"POMODORO_WORK",
			"PROMPT",
			"RATE_GLYPH",
			"RATE_LIMIT_FIVE_HOUR_LABEL",
			"RATE_LIMIT_SEPARATOR",
			"RATE_LIMIT_SEVEN_DAY_LABEL",
			"REVIEW_COMMENT",
			"REVIEW_COMMENT_MARK",
			"REVIEW_CURSOR",
			"SEPARATOR",
			"SUBMODE_GRILL",
			"SUBMODE_PLAN",
			"SUBMODE_STRAIGHT",
			"TIMER_GLYPH",
			"TOOL_PICK",
			"TURN_DONE",
		]);
	});

	it("exports exactly the four gauge glyphs", () => {
		expect(glyphs.GAUGE_GLYPHS).toHaveLength(4);
		expect(glyphs.GAUGE_GLYPHS.every((glyph) => glyph.length > 0)).toBe(true);
		expect(new Set(glyphs.GAUGE_GLYPHS).size).toBe(4);
	});

	it("maps every thinking level to a glyph, with off intentionally empty", () => {
		expect(Object.keys(glyphs.THINKING_LEVELS)).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"pro",
		]);
		expect(glyphs.THINKING_LEVELS.off).toBe("");
		for (const level of Object.keys(glyphs.THINKING_LEVELS).filter((key) => key !== "off")) {
			expect(glyphs.THINKING_LEVELS[level as keyof typeof glyphs.THINKING_LEVELS], level).not.toHaveLength(0);
		}
	});
});
