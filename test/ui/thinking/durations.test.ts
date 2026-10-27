import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { DURATION_ENTRY_TYPE, restoreDurationEntries } from "../../../extensions/ui/thinking/durations.ts";

interface RawEntry {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	customType?: string;
	data?: unknown;
}

function entry(overrides: Partial<RawEntry> = {}): SessionEntry {
	return {
		id: "e1",
		parentId: null,
		timestamp: "2025-01-01T00:00:00.000Z",
		...overrides,
	} as unknown as SessionEntry;
}

function durationEntry(data: unknown): SessionEntry {
	return entry({ type: "custom", customType: DURATION_ENTRY_TYPE, data });
}

function data(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
	return { messageTimestamp: 1000, contentIndex: 0, durationMs: 500, ...overrides };
}

describe("restoreDurationEntries", () => {
	it("clears the map before restoring", () => {
		const map = new Map<number, Map<number, number>>([[1, new Map([[0, 9]])]]);
		restoreDurationEntries([], map);
		expect(map.size).toBe(0);
	});

	it("ignores non-custom entries and other custom types", () => {
		const map = new Map<number, Map<number, number>>();
		restoreDurationEntries(
			[entry({ type: "message" }), entry({ type: "custom", customType: "other", data: data() })],
			map,
		);
		expect(map.size).toBe(0);
	});

	it("skips entries with invalid data", () => {
		const map = new Map<number, Map<number, number>>();
		restoreDurationEntries(
			[
				durationEntry(undefined),
				durationEntry("nope"),
				durationEntry(data({ messageTimestamp: Number.NaN })),
				durationEntry(data({ messageTimestamp: Number.POSITIVE_INFINITY })),
				durationEntry(data({ contentIndex: 1.5 })),
				durationEntry(data({ durationMs: 0 })),
				durationEntry(data({ durationMs: -5 })),
				durationEntry(data({ durationMs: Number.NaN })),
				durationEntry(data({ messageTimestamp: undefined })),
			],
			map,
		);
		expect(map.size).toBe(0);
	});

	it("groups valid entries by messageTimestamp with per-contentIndex durations", () => {
		const map = new Map<number, Map<number, number>>();
		restoreDurationEntries(
			[
				durationEntry(data()),
				durationEntry(data({ contentIndex: 1, durationMs: 250 })),
				durationEntry(data({ messageTimestamp: 2000, contentIndex: 0, durationMs: 750 })),
			],
			map,
		);
		expect(map.size).toBe(2);
		expect(map.get(1000)).toEqual(
			new Map([
				[0, 500],
				[1, 250],
			]),
		);
		expect(map.get(2000)).toEqual(new Map([[0, 750]]));
	});
});
