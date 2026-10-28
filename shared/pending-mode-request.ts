import type { SelectableAgentMode } from "./modes.ts";
import { createGlobalStore } from "./store.ts";

export interface PendingModeRequest {
	sessionId: string;
	mode: SelectableAgentMode;
}

const store = createGlobalStore<PendingModeRequest | undefined>(
	Symbol.for("@couralabs/pi-adhd/pending-mode-request"),
	undefined,
);

export function stagePendingModeRequest(sessionId: string, mode: SelectableAgentMode): void {
	store.set({ sessionId, mode });
}

export function takePendingModeRequest(sessionId: string): PendingModeRequest | undefined {
	const pending = store.get();
	store.set(undefined);
	if (pending === undefined || pending.sessionId !== sessionId) return undefined;
	return pending;
}
