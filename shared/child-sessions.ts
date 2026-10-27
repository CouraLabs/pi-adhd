const CHILD_SESSION_IDS = Symbol.for("@couralabs/pi-adhd/spawn-child-sessions");

function childSessionIds(): Set<string> {
	const store = globalThis as Record<symbol, unknown>;
	let ids = store[CHILD_SESSION_IDS] as Set<string> | undefined;
	if (!ids) {
		ids = new Set<string>();
		store[CHILD_SESSION_IDS] = ids;
	}
	return ids;
}

export function registerChildSession(sessionId: string): void {
	childSessionIds().add(sessionId);
}

export function isChildSession(sessionId: string | undefined): boolean {
	return sessionId !== undefined && childSessionIds().has(sessionId);
}
