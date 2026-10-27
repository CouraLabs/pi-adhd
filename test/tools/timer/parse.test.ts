import { describe, expect, it } from "vitest";
import { parseDuration } from "../../../extensions/tools/timer/parse.ts";

describe("parseDuration", () => {
	it("parses simple seconds", () => {
		expect(parseDuration("90s")).toBe(90_000);
	});

	it("parses compound units without separators", () => {
		expect(parseDuration("1h30m")).toBe(5_400_000);
	});

	it("parses compound units with spaces", () => {
		expect(parseDuration("1h 30m 10s")).toBe(5_410_000);
	});

	it("parses fractional values", () => {
		expect(parseDuration("0.5h")).toBe(1_800_000);
	});

	it("is case-insensitive", () => {
		expect(parseDuration("1H30M")).toBe(5_400_000);
	});

	it("is order-independent", () => {
		expect(parseDuration("30s1h")).toBe(3_630_000);
	});

	it("rejects repeated units", () => {
		expect(parseDuration("1m1m")).toBeUndefined();
	});

	it("rejects garbage leftovers", () => {
		expect(parseDuration("1h2x")).toBeUndefined();
	});

	it("rejects empty input", () => {
		expect(parseDuration("")).toBeUndefined();
		expect(parseDuration("   ")).toBeUndefined();
	});

	it("rejects zero totals", () => {
		expect(parseDuration("0s")).toBeUndefined();
		expect(parseDuration("0h0m")).toBeUndefined();
	});

	it("rejects non-numeric signs", () => {
		expect(parseDuration("-5m")).toBeUndefined();
	});
});
