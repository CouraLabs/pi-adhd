import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { labeledRule } from "../../shared/labeled-rule.ts";

const LEAD = "── ";
const TRAIL = " ──";

describe("labeledRule", () => {
	it("composes a rule with short left and right labels", () => {
		expect(labeledRule(20, (rule) => rule, ["abc"], ["xyz"])).toBe("── abc ────── xyz ──");
	});

	it("defaults the right label to none and fills to the full width", () => {
		expect(labeledRule(12, (rule) => rule, ["abc"])).toBe("── abc ─────");
	});

	it("measures exactly the requested width for the composed line", () => {
		const line = labeledRule(30, (rule) => rule, ["left"], ["right"]);
		expect(visibleWidth(line)).toBe(30);
	});

	it("applies paint to each rule segment", () => {
		const painted = labeledRule(15, (rule) => `<${rule}>`, ["ab"], ["c"]);
		expect(painted).toBe(`<${LEAD}>ab< ──── >c<${TRAIL}>`);
	});

	it("falls back through left candidates until one fits", () => {
		const left = ["first-candidate-too-long", "still-too-long-here", "fit"] as const;
		expect(labeledRule(15, (rule) => rule, left, ["R"])).toBe("── fit ─── R ──");
	});

	it("falls back through right candidates for the first fitting left label", () => {
		const right = ["way-too-long-right", "R"] as const;
		expect(labeledRule(15, (rule) => rule, ["abc"], right)).toBe("── abc ─── R ──");
	});

	it("prefers the first left candidate over a shorter later one", () => {
		expect(labeledRule(15, (rule) => rule, ["longer", "fit"], [])).toBe("── longer ─────");
	});

	it("truncates the last left candidate with an ellipsis when nothing fits", () => {
		const line = labeledRule(12, (rule) => rule, ["abcdefghij"]);
		const truncated = truncateToWidth("abcdefghij", 12 - LEAD.length - 2, "…");
		expect(line).toBe(`${LEAD}${truncated} ─`);
		expect(visibleWidth(line)).toBe(12);
	});

	it("uses the last candidate, not the first, for the full-truncation fallback", () => {
		const line = labeledRule(12, (rule) => rule, ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
		const truncated = truncateToWidth("bbbbbbbbbbbb", 12 - LEAD.length - 2, "…");
		expect(line).toBe(`${LEAD}${truncated} ─`);
	});

	it("truncation fallback leaves no right label even when one was requested", () => {
		const line = labeledRule(10, (rule) => rule, ["toolongleftlabel"], ["R"]);
		const truncated = truncateToWidth("toolongleftlabel", 10 - LEAD.length - 2, "…");
		expect(line).toBe(`${LEAD}${truncated} ─`);
		expect(line).not.toContain("R");
	});

	it("still emits lead and one fill glyph when width is smaller than the lead", () => {
		expect(labeledRule(2, (rule) => rule, ["label"])).toBe("──  ─");
	});
});
