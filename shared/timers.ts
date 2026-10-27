import { createGlobalStore } from "./store.ts";

export type TimerKind = "timer" | "pomodoro";

export type PomodoroPhase = "work" | "break" | "longBreak";

export interface ActiveTimer {
	id: string;
	name: string;

	endsAt: number;

	totalMs: number;
	kind: TimerKind;
	phase?: PomodoroPhase;
}

export interface TimerHandle {
	readonly id: string;
	cancel(): void;
}

const store = createGlobalStore<readonly ActiveTimer[]>(Symbol.for("@couralabs/pi-adhd/timers"), []);

const LIVE_HANDLES_KEY = Symbol.for("@couralabs/pi-adhd/timer-timeouts");

function liveTimeoutHandles(): Map<string, NodeJS.Timeout> {
	const root = globalThis as Record<symbol, Map<string, NodeJS.Timeout>>;
	let map = root[LIVE_HANDLES_KEY];
	if (!map) {
		map = new Map();
		root[LIVE_HANDLES_KEY] = map;
	}
	return map;
}

let sequence = 0;

export function nextTimerId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${++sequence}`;
}

export function getTimers(): readonly ActiveTimer[] {
	return store.get();
}

export function addTimer(timer: ActiveTimer): void {
	store.set([...store.get().filter((entry) => entry.id !== timer.id), timer]);
}

export function removeTimer(id: string): void {
	const current = store.get();
	const next = current.filter((entry) => entry.id !== id);
	if (next.length !== current.length) store.set(next);
}

export function subscribeTimers(listener: (timers: readonly ActiveTimer[]) => void): () => void {
	return store.subscribe(listener);
}

export function remainingMs(timer: ActiveTimer, now = Date.now()): number {
	return Math.max(0, timer.endsAt - now);
}

export function earliestTimer(timers: readonly ActiveTimer[], kind?: TimerKind): ActiveTimer | undefined {
	return timers.reduce<ActiveTimer | undefined>(
		(earliest, timer) => {
			if (kind && timer.kind !== kind) return earliest;
			return !earliest || timer.endsAt < earliest.endsAt ? timer : earliest;
		},
		undefined,
	);
}

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
		liveTimeoutHandles().delete(entry.id);
		removeTimer(entry.id);
		onFire(entry);
	}, spec.durationMs);
	liveTimeoutHandles().set(entry.id, handle);

	let cancelled = false;
	return {
		id: entry.id,
		cancel(): void {
			if (cancelled) return;
			cancelled = true;
			clearTimeout(handle);
			liveTimeoutHandles().delete(entry.id);
			removeTimer(entry.id);
		},
	};
}

export function cancelTimerById(id: string): boolean {
	const handle = liveTimeoutHandles().get(id);
	if (handle) {
		clearTimeout(handle);
		liveTimeoutHandles().delete(id);
		removeTimer(id);
		return true;
	}
	removeTimer(id);
	return false;
}

export function formatDuration(ms: number): string {
	return formatUnits(Math.round(ms / 1000));
}

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
