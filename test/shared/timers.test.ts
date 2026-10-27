import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addTimer,
	cancelTimerById,
	earliestTimer,
	formatCountdown,
	formatDuration,
	getTimers,
	nextTimerId,
	remainingMs,
	removeTimer,
	scheduleTimer,
	type ActiveTimer,
} from "../../shared/timers.ts";

function timer(id: string, endsAt: number, kind: ActiveTimer["kind"] = "timer"): ActiveTimer {
	return { id, name: id, endsAt, totalMs: 60_000, kind };
}

describe("timers", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		for (const entry of getTimers()) cancelTimerById(entry.id);
		vi.useRealTimers();
	});

	it("generates unique ids with the given prefix", () => {
		const first = nextTimerId("timer");
		const second = nextTimerId("timer");
		expect(first).not.toBe(second);
		expect(first.startsWith("timer-")).toBe(true);
		expect(second.startsWith("timer-")).toBe(true);
	});

	it("keeps different prefixes distinct", () => {
		expect(nextTimerId("timer")).not.toBe(nextTimerId("pomodoro"));
	});

	it("adds a timer to the store", () => {
		addTimer(timer("t1", 1_000));
		expect(getTimers().map((entry) => entry.id)).toEqual(["t1"]);
	});

	it("replaces a timer with the same id and moves it to the end", () => {
		addTimer(timer("t1", 1_000));
		addTimer(timer("t2", 2_000));
		addTimer(timer("t1", 3_000));
		expect(getTimers().map((entry) => entry.id)).toEqual(["t2", "t1"]);
		expect(getTimers()[1].endsAt).toBe(3_000);
	});

	it("removes a timer by id", () => {
		addTimer(timer("t1", 1_000));
		addTimer(timer("t2", 2_000));
		removeTimer("t1");
		expect(getTimers().map((entry) => entry.id)).toEqual(["t2"]);
	});

	it("ignores removal of unknown ids", () => {
		addTimer(timer("t1", 1_000));
		removeTimer("missing");
		expect(getTimers()).toHaveLength(1);
	});

	it("clamps remaining time at zero for expired timers", () => {
		expect(remainingMs(timer("t1", 2_000), 3_000)).toBe(0);
		expect(remainingMs(timer("t1", 2_000), 2_000)).toBe(0);
		expect(remainingMs(timer("t1", 2_000), 1_000)).toBe(1_000);
	});

	it("finds the earliest timer without a kind filter", () => {
		const timers = [timer("late", 3_000), timer("early", 1_000), timer("middle", 2_000)];
		expect(earliestTimer(timers)?.id).toBe("early");
	});

	it("finds the earliest timer within a kind", () => {
		const timers = [
			timer("timer-late", 3_000, "timer"),
			timer("pomo", 2_000, "pomodoro"),
			timer("timer-early", 1_000, "timer"),
		];
		expect(earliestTimer(timers, "pomodoro")?.id).toBe("pomo");
		expect(earliestTimer(timers, "timer")?.id).toBe("timer-early");
	});

	it("returns undefined when no timer matches the kind", () => {
		expect(earliestTimer([timer("t1", 1_000)], "pomodoro")).toBeUndefined();
		expect(earliestTimer([], "timer")).toBeUndefined();
	});

	it("formats durations as h/m/s, dropping empty units", () => {
		expect(formatDuration(0)).toBe("0s");
		expect(formatDuration(59_000)).toBe("59s");
		expect(formatDuration(60_000)).toBe("1m");
		expect(formatDuration(3_600_000)).toBe("1h");
		expect(formatDuration(3_600_000 + 2 * 60_000)).toBe("1h2m");
		expect(formatDuration(3_600_000 + 2 * 60_000 + 30_000)).toBe("1h2m30s");
	});

	it("formats countdowns by ceiling to the next second", () => {
		expect(formatCountdown(1_500)).toBe("2s");
		expect(formatCountdown(1_000)).toBe("1s");
		expect(formatCountdown(0)).toBe("0s");
		expect(formatCountdown(-1_000)).toBe("0s");
		expect(formatCountdown(3_600_000 + 60_000 + 500)).toBe("1h1m1s");
	});

	it("schedules a timer that fires once and removes itself", () => {
		const fired: ActiveTimer[] = [];
		const startedAt = Date.now();
		const handle = scheduleTimer({ id: nextTimerId("timer"), name: "tea", durationMs: 1_000, kind: "timer" }, (entry) => {
			fired.push(entry);
		});
		expect(getTimers()).toHaveLength(1);
		expect(getTimers()[0].id).toBe(handle.id);
		expect(getTimers()[0].endsAt).toBe(startedAt + 1_000);
		expect(getTimers()[0].totalMs).toBe(1_000);

		vi.advanceTimersByTime(999);
		expect(fired).toHaveLength(0);
		expect(getTimers()).toHaveLength(1);

		vi.advanceTimersByTime(1);
		expect(fired).toHaveLength(1);
		expect(fired[0].name).toBe("tea");
		expect(getTimers()).toHaveLength(0);
	});

	it("cancels a scheduled timer before it fires", () => {
		const fired: ActiveTimer[] = [];
		const handle = scheduleTimer({ id: nextTimerId("timer"), name: "tea", durationMs: 1_000, kind: "timer" }, (entry) => {
			fired.push(entry);
		});
		expect(cancelTimerById(handle.id)).toBe(true);
		expect(getTimers()).toHaveLength(0);
		vi.advanceTimersByTime(5_000);
		expect(fired).toHaveLength(0);
	});

	it("reports false when cancelling an unknown id", () => {
		expect(cancelTimerById("missing")).toBe(false);
	});

	it("reports false when cancelling an already fired timer", () => {
		const fired: ActiveTimer[] = [];
		const handle = scheduleTimer({ id: nextTimerId("timer"), name: "tea", durationMs: 1_000, kind: "timer" }, (entry) => {
			fired.push(entry);
		});
		vi.advanceTimersByTime(1_000);
		expect(fired).toHaveLength(1);
		expect(cancelTimerById(handle.id)).toBe(false);
	});
});
