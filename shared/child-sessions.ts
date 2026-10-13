/**
 * child-sessions — process-wide registry of spawned child session IDs.
 *
 * A child session loads its own copy of every extension (children inherit the
 * parent's extensions), and each copy's `session_start` would otherwise
 * re-activate its tools or publish process-global state. Registering child
 * session IDs lets those copies recognize themselves and stay inert.
 *
 * Keyed on `Symbol.for` so the parent and every child share one set even when
 * this module is instantiated more than once in the process (jiti, reloads).
 * IDs are never reused, so entries are never removed and stale ones are inert.
 */

const CHILD_SESSION_IDS = Symbol.for("@couralabs/pi-tdah/spawn-child-sessions");

function childSessionIds(): Set<string> {
	const store = globalThis as Record<symbol, unknown>;
	let ids = store[CHILD_SESSION_IDS] as Set<string> | undefined;
	if (!ids) {
		ids = new Set<string>();
		store[CHILD_SESSION_IDS] = ids;
	}
	return ids;
}

/** Record a session ID as belonging to a spawned child session. */
export function registerChildSession(sessionId: string): void {
	childSessionIds().add(sessionId);
}

/** Whether `sessionId` is a spawned child session created in this process. */
export function isChildSession(sessionId: string | undefined): boolean {
	return sessionId !== undefined && childSessionIds().has(sessionId);
}
