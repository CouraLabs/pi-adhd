import { createGlobalStore } from "./store.ts";

interface ThinkingTokensState {
	readonly sessionKey: string;
	readonly total: number;
}

const EMPTY_STATE: ThinkingTokensState = { sessionKey: "", total: 0 };

const store = createGlobalStore<ThinkingTokensState>(Symbol.for("@couralabs/pi-adhd/thinking-tokens"), EMPTY_STATE);

export function getThinkingTokens(sessionKey: string): number {
	const state = store.get();
	return state.sessionKey === sessionKey ? state.total : 0;
}

export function addThinkingTokens(sessionKey: string, delta: number): void {
	if (delta <= 0) return;
	const state = store.get();
	const base = state.sessionKey === sessionKey ? state.total : 0;
	store.set({ sessionKey, total: base + delta });
}

export function resetThinkingTokens(sessionKey: string): void {
	if (store.get().sessionKey !== sessionKey) return;
	store.set({ sessionKey, total: 0 });
}

export function subscribeThinkingTokens(listener: () => void): () => void {
	return store.subscribe(listener);
}
