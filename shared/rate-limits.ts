/**
 * rate-limits — shared state for the Claude plan rate-limit gauge.
 *
 * The Claude provider publishes the latest utilization it has seen for each
 * plan window (5-hour and 7-day) here, and the footer renders them. The state
 * lives on `globalThis` (see `store.ts`) so both sides share one registry even
 * when their modules load twice.
 */

import { createGlobalStore } from "./store.ts";

export type RateLimitWindowId = "fiveHour" | "sevenDay";

export interface RateLimitWindow {
	/** Share of the window already consumed, 0-100. */
	percent: number;
	/** Epoch milliseconds when the window resets. */
	resetsAt: number;
}

export type RateLimits = Readonly<Partial<Record<RateLimitWindowId, RateLimitWindow>>>;

const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const SECONDS_TIMESTAMP_CEILING = 1e11;

const store = createGlobalStore<RateLimits>(Symbol.for("@couralabs/pi-adhd/rate-limits"), {});

export function getRateLimits(): RateLimits {
	return store.get();
}

export function setRateLimitWindow(id: RateLimitWindowId, window: RateLimitWindow): void {
	store.set({ ...store.get(), [id]: window });
}

export function clearRateLimits(): void {
	store.set({});
}

export function subscribeRateLimits(listener: (limits: RateLimits) => void): () => void {
	return store.subscribe(listener);
}

/** SDK reset timestamps are epoch seconds; accept milliseconds too. */
export function resetTimestampToMilliseconds(timestamp: number): number {
	return timestamp < SECONDS_TIMESTAMP_CEILING ? timestamp * 1000 : timestamp;
}

/** SDK utilization is a 0-1 fraction of the window; returns a clamped 0-100 percent. */
export function utilizationToPercent(utilization: number): number {
	return Math.max(0, Math.min(100, utilization * 100));
}

/** Time until `resetsAt` as `1d11h`, `1h50m`, or `42m`; undefined once the window has reset. */
export function formatTimeUntilReset(resetsAt: number, now = Date.now()): string | undefined {
	const remainingMs = resetsAt - now;
	if (remainingMs <= 0) return undefined;
	const totalMinutes = Math.floor(remainingMs / MILLISECONDS_PER_MINUTE);
	const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
	const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
	const minutes = totalMinutes % MINUTES_PER_HOUR;
	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	return `${minutes}m`;
}
