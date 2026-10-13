/**
 * store — a process-global value with change notifications.
 *
 * pi-adhd extension instances are not guaranteed to share module state (jiti
 * reloads, child sessions, duplicate installs), so cross-extension state lives
 * on `globalThis` under a registered symbol. This helper owns that pattern: the
 * value and its listeners are created lazily on first use, and the first caller
 * with a given key wins so every module that calls it shares one store.
 */

interface StoreState<T> {
	value: T;
	listeners: Set<(value: T) => void>;
}

export interface GlobalStore<T> {
	/** The current value. */
	get(): T;
	/** Set the value and notify subscribers. No-op when unchanged. */
	set(value: T): void;
	/** Subscribe to changes; returns an unsubscribe function. */
	subscribe(listener: (value: T) => void): () => void;
}

/**
 * Create (or recover) the process-global store registered under `key`. Callers
 * that pass the same key share the value even when their modules are loaded
 * more than once.
 */
export function createGlobalStore<T>(key: symbol, initial: T): GlobalStore<T> {
	const root = globalThis as Record<symbol, unknown>;
	const state = (): StoreState<T> => {
		let existing = root[key] as StoreState<T> | undefined;
		if (!existing) {
			existing = { value: initial, listeners: new Set() };
			root[key] = existing;
		}
		return existing;
	};
	return {
		get: () => state().value,
		set: (value) => {
			const current = state();
			if (Object.is(current.value, value)) return;
			current.value = value;
			for (const listener of [...current.listeners]) listener(value);
		},
		subscribe: (listener) => {
			const current = state();
			current.listeners.add(listener);
			return () => {
				current.listeners.delete(listener);
			};
		},
	};
}
