/**
 * spawn-service — the process-global slot the spawn extension publishes
 * its service into, and any extension (the footer, other tools) reads from.
 *
 * The key is registered with `Symbol.for` so a child session's separately loaded
 * copy of the extension resolves the same slot. This module owns no spawn
 * types: consumers name only the narrow surface they read.
 */

/** Key of the process-global service slot (`Symbol.for` so every loaded copy agrees). */
const SERVICE_KEY = Symbol.for("@couralabs/pi-adhd/spawn");

/** The usage slice a consumer reads from an agent record. */
export interface SpawnUsageRecord {
	lifetimeUsage?: { cost?: number };
}

/** The narrow spawn service surface the footer consumes. */
export interface SpawnServiceConsumer {
	listAgents(): readonly SpawnUsageRecord[];
}

/** Publish the service on globalThis for cross-extension access. */
export function publishSpawnService(service: unknown): void {
	const store = globalThis as Record<symbol, unknown>;
	// The spawn extension publishes from session_start, where it knows the
	// session is a parent and never publishes for a child. The empty-slot guard
	// remains as defense in depth: a second parent publish (reload, session
	// switch) must not race an existing service out of the slot.
	if (store[SERVICE_KEY] === undefined) store[SERVICE_KEY] = service;
}

/** Retrieve the published service, or undefined if not yet published. */
export function getSpawnService<T = unknown>(): T | undefined {
	return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as T | undefined;
}

/** Remove the service from globalThis (call on shutdown/reload). */
export function unpublishSpawnService(): void {
	// eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property; Map.delete() is not applicable
	delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}
