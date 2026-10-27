import { describe, expect, it } from "vitest";
import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntries, UsageTheme } from "../../shared/usage.ts";
import { addUsage, computeUsage, emptyUsage, usageCost, usageGroup } from "../../shared/usage.ts";

function usage(input: number, output: number, cacheRead = 0, cacheWrite = 0, total = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
	};
}

function subagentEntry(id: string, input: number, output: number, cacheRead: number, cacheWrite: number, cost: number) {
	return {
		type: "custom",
		customType: "subagent-usage",
		data: { id, input, output, cacheRead, cacheWrite, cost },
	};
}

const taggedTheme: UsageTheme = { fg: (color, text) => `[${color}]${text}` };

describe("emptyUsage", () => {
	it("returns an all-zero totals shape", () => {
		expect(emptyUsage()).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			cacheHitRate: 0,
			entries: 0,
			subagentCost: 0,
		});
	});
});

describe("addUsage", () => {
	it("ignores undefined usage", () => {
		const totals = emptyUsage();
		addUsage(totals, undefined);
		expect(totals).toEqual(emptyUsage());
	});

	it("adds every usage field", () => {
		const totals = emptyUsage();
		addUsage(totals, usage(10, 20, 30, 40, 0.5));
		expect(totals).toEqual({
			input: 10,
			output: 20,
			cacheRead: 30,
			cacheWrite: 40,
			cost: 0.5,
			cacheHitRate: 0,
			entries: 0,
			subagentCost: 0,
		});
	});

	it("accumulates across calls", () => {
		const totals = emptyUsage();
		addUsage(totals, usage(10, 10, 0, 0, 0.25));
		addUsage(totals, usage(1, 2, 3, 4, 0.75));
		expect(totals.input).toBe(11);
		expect(totals.output).toBe(12);
		expect(totals.cacheRead).toBe(3);
		expect(totals.cacheWrite).toBe(4);
		expect(totals.cost).toBe(1);
	});

	it("counts usage without cost as zero cost", () => {
		const totals = emptyUsage();
		const noCost = { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: undefined } as unknown as Usage;
		addUsage(totals, noCost);
		expect(totals.input).toBe(5);
		expect(totals.cost).toBe(0);
	});
});

describe("computeUsage", () => {
	it("sums usage entries, messages, tool results, branch summaries, and compactions", () => {
		const entries = [
			{ type: "usage", usage: usage(10, 5, 2, 3, 0.01) },
			{ type: "message", message: { role: "assistant", usage: usage(100, 50, 60, 40, 0.5) } },
			{ type: "message", message: { role: "toolResult", usage: usage(7, 0, 0, 0, 0.02) } },
			{ type: "branch_summary", usage: usage(1, 1, 0, 0, 0.001) },
			{ type: "compaction", usage: usage(2, 2, 0, 0, 0.002) },
		] as unknown as SessionEntries;

		const totals = computeUsage(entries);

		expect(totals.input).toBe(120);
		expect(totals.output).toBe(58);
		expect(totals.cacheRead).toBe(62);
		expect(totals.cacheWrite).toBe(43);
		expect(totals.cost).toBeCloseTo(0.533);
		expect(totals.subagentCost).toBe(0);
	});

	it("takes the cache hit rate from the latest assistant message", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", usage: usage(100, 10, 100, 0, 0.1) } },
			{ type: "message", message: { role: "assistant", usage: usage(100, 10, 300, 0, 0.1) } },
		] as unknown as SessionEntries;
		expect(computeUsage(entries).cacheHitRate).toBe(75);
	});

	it("falls back to a zero cache hit rate when the latest assistant prompt is empty", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", usage: usage(100, 10, 100, 0, 0.1) } },
			{ type: "message", message: { role: "assistant", usage: usage(0, 10, 0, 0, 0.1) } },
		] as unknown as SessionEntries;
		expect(computeUsage(entries).cacheHitRate).toBe(0);
	});

	it("ignores user and non-usage messages", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: "hello" } },
			{ type: "message", message: { role: "toolResult", output: "done" } },
		] as unknown as SessionEntries;
		expect(computeUsage(entries)).toEqual(emptyUsage());
	});

	it("adds subagent cost from subagent-usage entries", () => {
		const entries = [
			subagentEntry("planner", 10, 20, 30, 40, 0.25),
			subagentEntry("reviewer", 1, 2, 3, 4, 0.5),
			subagentEntry("planner", 100, 0, 0, 0, 1),
		] as unknown as SessionEntries;

		const totals = computeUsage(entries);

		expect(totals.subagentCost).toBe(1.5);
		expect(totals.cost).toBe(0);
	});
});

describe("usageGroup", () => {
	it("renders nothing when every token count is zero", () => {
		expect(usageGroup(emptyUsage(), taggedTheme)).toBe("");
	});

	it("renders the input group with input plus cache write, plus the cache group cache write implies", () => {
		const totals = { ...emptyUsage(), input: 1_000, cacheWrite: 500 };
		expect(usageGroup(totals, taggedTheme)).toBe("[success]↑ [thinkingText]1.5k [warning]⮏ [thinkingText]0.00%");
	});

	it("omits the input group when input is zero", () => {
		const totals = { ...emptyUsage(), cacheWrite: 500 };
		expect(usageGroup(totals, taggedTheme)).not.toContain("success");
	});

	it("renders the output group", () => {
		const totals = { ...emptyUsage(), output: 2_000 };
		expect(usageGroup(totals, taggedTheme)).toBe("[accent]↓ [thinkingText]2.0k");
	});

	it("omits the output group when output is zero", () => {
		expect(usageGroup({ ...emptyUsage(), input: 10 }, taggedTheme)).not.toContain("accent");
	});

	it("renders the cache group with the hit rate", () => {
		const totals = { ...emptyUsage(), cacheRead: 100, cacheHitRate: 30 };
		expect(usageGroup(totals, taggedTheme)).toBe("[warning]⮏ [thinkingText]30.00%");
	});

	it("counts cache write toward the cache group", () => {
		const totals = { ...emptyUsage(), cacheWrite: 100, cacheHitRate: 0 };
		expect(usageGroup(totals, taggedTheme)).toBe("[warning]⮏ [thinkingText]0.00%");
	});

	it("joins all three groups with spaces", () => {
		const totals = { ...emptyUsage(), input: 1_000, output: 2_000, cacheRead: 100, cacheHitRate: 30 };
		const rendered = usageGroup(totals, taggedTheme);
		expect(rendered).toContain("[success]↑ [thinkingText]1.0k");
		expect(rendered).toContain("[accent]↓ [thinkingText]2.0k");
		expect(rendered).toContain("[warning]⮏ [thinkingText]30.00%");
	});
});

describe("usageCost", () => {
	it("renders nothing when both costs are zero", () => {
		expect(usageCost(emptyUsage(), taggedTheme)).toBe("");
		expect(usageCost(emptyUsage(), taggedTheme, 0)).toBe("");
	});

	it("renders the session cost with three decimals", () => {
		const totals = { ...emptyUsage(), cost: 0.5 };
		expect(usageCost(totals, taggedTheme)).toBe("[warning]$0.500");
	});

	it("appends the extra cost in parentheses", () => {
		const totals = { ...emptyUsage(), cost: 0.5 };
		expect(usageCost(totals, taggedTheme, 0.25)).toBe("[warning]$0.500[dim] ($0.250)");
	});

	it("renders the zero session cost alongside a non-zero extra cost", () => {
		expect(usageCost(emptyUsage(), taggedTheme, 0.25)).toBe("[warning]$0.000[dim] ($0.250)");
	});
});
