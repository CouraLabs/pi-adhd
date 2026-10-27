import { describe, expect, it } from "vitest";
import {
	SUBAGENT_USAGE_ENTRY,
	readSubagentUsage,
	toSubagentUsage,
	type SubagentUsageEntryLike,
} from "../../shared/subagent-usage.ts";

function entry(data: unknown, customType: string = SUBAGENT_USAGE_ENTRY): SubagentUsageEntryLike {
	return { type: "custom", customType, data };
}

function usage(id: string, input: number, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0) {
	return { id, input, output, cacheRead, cacheWrite, cost };
}

describe("toSubagentUsage", () => {
	it("defaults every field to zero without lifetime usage", () => {
		expect(toSubagentUsage({ id: "agent" })).toEqual({
			id: "agent",
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		});
	});

	it("defaults missing lifetime usage fields to zero", () => {
		expect(toSubagentUsage({ id: "agent", lifetimeUsage: { input: 5, cost: 0.25 } })).toEqual({
			id: "agent",
			input: 5,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0.25,
		});
	});

	it("copies every lifetime usage field", () => {
		expect(
			toSubagentUsage({ id: "agent", lifetimeUsage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 } }),
		).toEqual({ id: "agent", input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 });
	});
});

describe("readSubagentUsage", () => {
	it("returns zeros for no entries", () => {
		expect(readSubagentUsage([])).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
	});

	it("ignores entries that are not custom subagent-usage entries", () => {
		const entries: SubagentUsageEntryLike[] = [
			{ type: "message", data: usage("a", 10) },
			{ type: "custom", customType: "other-entry", data: usage("b", 20) },
			{ type: "custom", data: usage("c", 30) },
		];
		expect(readSubagentUsage(entries)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
	});

	it("skips entries whose data is not a valid usage record", () => {
		const entries: SubagentUsageEntryLike[] = [
			entry("not an object"),
			entry(null),
			entry({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 5 }),
			entry({ id: 7, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 5 }),
			entry({ id: "a", input: "1", output: 2, cacheRead: 3, cacheWrite: 4, cost: 5 }),
			entry({ id: "a", input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }),
			entry(usage("a", 10, 20, 30, 40, 0.5)),
		];
		expect(readSubagentUsage(entries)).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.5 });
	});

	it("keeps only the latest record per agent id", () => {
		const entries: SubagentUsageEntryLike[] = [
			entry(usage("a", 10, 10, 10, 10, 1)),
			entry(usage("b", 5, 5, 5, 5, 0.25)),
			entry(usage("a", 20, 0, 0, 0, 2)),
		];
		expect(readSubagentUsage(entries)).toEqual({ input: 25, output: 5, cacheRead: 5, cacheWrite: 5, cost: 2.25 });
	});

	it("sums totals across distinct agent ids", () => {
		const entries: SubagentUsageEntryLike[] = [
			entry(usage("a", 10, 20, 30, 40, 0.5)),
			entry(usage("b", 1, 2, 3, 4, 0.25)),
		];
		expect(readSubagentUsage(entries)).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, cost: 0.75 });
	});
});
