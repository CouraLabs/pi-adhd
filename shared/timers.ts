/**
 * timers — shared state for the `timer` and `pomodoro` extensions.
 *
 * Every running countdown — a plain `/timer` or one phase of a pomodoro
 * session — is published here so the footer can show the next one to expire.
 * The state lives on `globalThis` (see `store.ts`), so the timer, pomodoro, and
 * footer extensions share one registry even when their modules load twice.
 *
 * This module owns only the registry and scheduling: it starts a `setTimeout`
 * for a countdown, publishes the entry, and removes it when it fires. Callers
 * decide what happens on fire (notification, chaining the next pomodoro phase,
 * and so on). A handle's `cancel()` clears the timeout and the entry, so
 * `session_shutdown` can tear everything down.
 */

import { createGlobalStore } from "./store.ts";

/** Which extension owns a countdown. */
export type TimerKind = "timer" | "pomodoro";

/** Pomodoro phase; absent for a plain timer. */
export type PomodoroPhase = "work" | "break" | "longBreak";

/** One running countdown, as the footer and any lister sees it. */
export interface ActiveTimer {
	id: string;
	name: string;
	/** Epoch milliseconds when the countdown reaches zero. */
	endsAt: number;
	/** Total length of the countdown, for context. */
	totalMs: number;
	kind: TimerKind;
	phase?: PomodoroPhase;
}

/** A scheduled countdown that can be cancelled. */
export interface TimerHandle {
	readonly id: string;
	cancel(): void;
}

const store = createGlobalStore<readonly ActiveTimer[]>(Symbol.for("@couralabs/pi-adhd/timers"), []);

let sequence = 0;

/** A collision-resistant id; the counter resets on reload, the timestamp does not. */
export function nextTimerId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${++sequence}`;
}

/** Every running countdown, oldest-added first. */
export function getTimers(): readonly ActiveTimer[] {
	return store.get();
}

/** Publish or replace one countdown. */
export function addTimer(timer: ActiveTimer): void {
	store.set([...store.get().filter((entry) => entry.id !== timer.id), timer]);
}

/** Remove one countdown by id. No-op when it is already gone. */
export function removeTimer(id: string): void {
	const current = store.get();
	const next = current.filter((entry) => entry.id !== id);
	if (next.length !== current.length) store.set(next);
}

/** Subscribe to registry changes; returns an unsubscribe function. */
export function subscribeTimers(listener: (timers: readonly ActiveTimer[]) => void): () => void {
	return store.subscribe(listener);
}

/** Milliseconds left on a countdown, clamped at zero. */
export function remainingMs(timer: ActiveTimer, now = Date.now()): number {
	return Math.max(0, timer.endsAt - now);
}

/** The countdown that expires first, optionally restricted to one kind. */
export function earliestTimer(timers: readonly ActiveTimer[], kind?: TimerKind): ActiveTimer | undefined {
	return timers.reduce<ActiveTimer | undefined>(
		(earliest, timer) => {
			if (kind && timer.kind !== kind) return earliest;
			return !earliest || timer.endsAt < earliest.endsAt ? timer : earliest;
		},
		undefined,
	);
}

/** Start a countdown and resolve when it is scheduled or cancelled. */
export function scheduleTimer(
	spec: { id: string; name: string; durationMs: number; kind: TimerKind; phase?: PomodoroPhase },
	onFire: (timer: ActiveTimer) => void,
): TimerHandle {
	const entry: ActiveTimer = {
		id: spec.id,
		name: spec.name,
		endsAt: Date.now() + spec.durationMs,
		totalMs: spec.durationMs,
		kind: spec.kind,
		phase: spec.phase,
	};
	addTimer(entry);

	const handle = setTimeout(() => {
		removeTimer(entry.id);
		onFire(entry);
	}, spec.durationMs);

	let cancelled = false;
	return {
		id: entry.id,
		cancel(): void {
			if (cancelled) return;
			cancelled = true;
			clearTimeout(handle);
			removeTimer(entry.id);
		},
	};
}

/** Human-readable duration such as `1h30m`, `5m`, or `45s` (rounds to the nearest second). */
export function formatDuration(ms: number): string {
	return formatUnits(Math.round(ms / 1000));
}

/** Countdown text such as `1h20m30s`, `5m`, or `9s` (rounds up, so a running timer never shows 0s early). */
export function formatCountdown(ms: number): string {
	return formatUnits(Math.max(0, Math.ceil(ms / 1000)));
}

function formatUnits(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
	return parts.join("");
}
