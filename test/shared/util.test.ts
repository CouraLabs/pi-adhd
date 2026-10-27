import { describe, expect, it } from "vitest";
import { clamp, clipIndicator, replaceTabs } from "../../shared/util.ts";

describe("clamp", () => {
	it("returns the value when it is within bounds", () => {
		expect(clamp(5, 0, 10)).toBe(5);
	});

	it("returns min when the value is below the range", () => {
		expect(clamp(-3, 0, 10)).toBe(0);
	});

	it("returns max when the value is above the range", () => {
		expect(clamp(42, 0, 10)).toBe(10);
	});

	it("returns NaN unchanged because Math.min and Math.max propagate it", () => {
		expect(clamp(Number.NaN, 0, 10)).toBeNaN();
	});
});

describe("replaceTabs", () => {
	it("replaces each tab with four spaces", () => {
		expect(replaceTabs("a\tb")).toBe("a    b");
	});

	it("replaces every tab in the string", () => {
		expect(replaceTabs("\ta\t\tb")).toBe("    a        b");
	});

	it("leaves text without tabs untouched", () => {
		expect(replaceTabs("no tabs here")).toBe("no tabs here");
	});
});

describe("clipIndicator", () => {
	it("returns an empty string when everything is visible", () => {
		expect(clipIndicator(0, 5, 5)).toBe("");
	});

	it("returns a down arrow when content is clipped below", () => {
		expect(clipIndicator(0, 5, 10)).toBe("↓");
	});

	it("returns an up arrow when content is clipped above", () => {
		expect(clipIndicator(5, 5, 10)).toBe("↑");
	});

	it("returns an up-down arrow when content is clipped on both sides", () => {
		expect(clipIndicator(3, 4, 10)).toBe("↕");
	});

	it("does not report content below when the window ends exactly at totalRows", () => {
		expect(clipIndicator(5, 5, 10)).toBe("↑");
	});
});
