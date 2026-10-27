interface StoreState<T> {
	value: T;
	listeners: Set<(value: T) => void>;
}

export interface GlobalStore<T> {

	get(): T;

	set(value: T): void;

	subscribe(listener: (value: T) => void): () => void;
}

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
