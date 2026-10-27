import { createGlobalStore } from "./store.ts";

export type RateLimitWindowId = "fiveHour" | "sevenDay";

export interface RateLimitWindow {

	percent: number;

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

export function resetTimestampToMilliseconds(timestamp: number): number {
	return timestamp < SECONDS_TIMESTAMP_CEILING ? timestamp * 1000 : timestamp;
}

export function utilizationToPercent(utilization: number): number {
	return Math.max(0, Math.min(100, utilization * 100));
}

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
