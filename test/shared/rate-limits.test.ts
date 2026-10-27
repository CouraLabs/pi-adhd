import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearRateLimits,
	formatTimeUntilReset,
	getRateLimits,
	resetTimestampToMilliseconds,
	setRateLimitWindow,
	subscribeRateLimits,
	utilizationToPercent,
	type RateLimits,
} from "../../shared/rate-limits.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("rate limits", () => {
	beforeEach(() => {
		clearRateLimits();
	});

	afterEach(() => {
		clearRateLimits();
	});

	it("starts with no windows", () => {
		expect(getRateLimits()).toEqual({});
	});

	it("stores each window under its id", () => {
		setRateLimitWindow("fiveHour", { percent: 40, resetsAt: 1_000 });
		setRateLimitWindow("sevenDay", { percent: 10, resetsAt: 2_000 });
		expect(getRateLimits()).toEqual({
			fiveHour: { percent: 40, resetsAt: 1_000 },
			sevenDay: { percent: 10, resetsAt: 2_000 },
		});
	});

	it("replaces a window with the same id", () => {
		setRateLimitWindow("fiveHour", { percent: 40, resetsAt: 1_000 });
		setRateLimitWindow("fiveHour", { percent: 90, resetsAt: 3_000 });
		expect(getRateLimits()).toEqual({ fiveHour: { percent: 90, resetsAt: 3_000 } });
	});

	it("clears every window", () => {
		setRateLimitWindow("fiveHour", { percent: 40, resetsAt: 1_000 });
		clearRateLimits();
		expect(getRateLimits()).toEqual({});
	});

	it("notifies subscribers on change until unsubscribed", () => {
		const seen: RateLimits[] = [];
		const unsubscribe = subscribeRateLimits((limits) => seen.push(limits));
		setRateLimitWindow("fiveHour", { percent: 40, resetsAt: 1_000 });
		expect(seen).toEqual([{ fiveHour: { percent: 40, resetsAt: 1_000 } }]);
		unsubscribe();
		setRateLimitWindow("fiveHour", { percent: 90, resetsAt: 2_000 });
		expect(seen).toHaveLength(1);
	});

	it("converts second timestamps below the ceiling to milliseconds", () => {
		expect(resetTimestampToMilliseconds(1_700_000_000)).toBe(1_700_000_000_000);
	});

	it("leaves already-millisecond timestamps unchanged", () => {
		expect(resetTimestampToMilliseconds(1_700_000_000_000)).toBe(1_700_000_000_000);
	});

	it("treats the ceiling value itself as milliseconds", () => {
		expect(resetTimestampToMilliseconds(1e11)).toBe(1e11);
	});

	it("clamps utilization to 0..100", () => {
		expect(utilizationToPercent(0.5)).toBe(50);
		expect(utilizationToPercent(0)).toBe(0);
		expect(utilizationToPercent(-1)).toBe(0);
		expect(utilizationToPercent(1)).toBe(100);
		expect(utilizationToPercent(1.5)).toBe(100);
	});

	it("formats days and hours when more than a day remains", () => {
		const now = 1_000_000_000_000;
		expect(formatTimeUntilReset(now + 5 * DAY + 3 * HOUR + 20 * MINUTE, now)).toBe("5d3h");
	});

	it("formats hours and minutes when less than a day remains", () => {
		const now = 1_000_000_000_000;
		expect(formatTimeUntilReset(now + 2 * HOUR + 5 * MINUTE, now)).toBe("2h5m");
	});

	it("formats bare minutes when less than an hour remains", () => {
		const now = 1_000_000_000_000;
		expect(formatTimeUntilReset(now + 7 * MINUTE, now)).toBe("7m");
	});

	it("returns undefined once the reset time has passed", () => {
		const now = 1_000_000_000_000;
		expect(formatTimeUntilReset(now - 1, now)).toBeUndefined();
	});

	it("returns undefined exactly at the reset time", () => {
		const now = 1_000_000_000_000;
		expect(formatTimeUntilReset(now, now)).toBeUndefined();
	});
});
