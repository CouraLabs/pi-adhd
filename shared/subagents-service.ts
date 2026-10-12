/**
 * subagents-service — the process-global slot a subagents extension publishes
 * its service into, and any extension (the footer, other tools) reads from.
 *
 * The key is registered with `Symbol.for` so a child session's separately loaded
 * copy of the extension resolves the same slot. This module owns no subagents
 * types: consumers name only the narrow surface they read.
 */

/** Key of the process-global service slot (`Symbol.for` so every loaded copy agrees). */
const SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");

/** The usage slice a consumer reads from an agent record. */
export interface SubagentUsageRecord {
	lifetimeUsage?: { cost?: number };
}

/** The narrow subagents service surface the footer consumes. */
export interface SubagentsServiceConsumer {
	listAgents(): readonly SubagentUsageRecord[];
}

/** Publish the service on globalThis for cross-extension access. */
export function publishSubagentsService(service: unknown): void {
	const store = globalThis as Record<symbol, unknown>;
	// A child session loads its own copy of the subagents extension and publishes
	// its own (empty) service at load time, before it can know it is a child.
	// Never let that clobber the parent's service, which is the one other
	// extensions consume. The parent always loads first, and unpublication on
	// reload clears the slot before the next parent factory publishes.
	if (store[SERVICE_KEY] === undefined) store[SERVICE_KEY] = service;
}

/** Retrieve the published service, or undefined if not yet published. */
export function getSubagentsService<T = unknown>(): T | undefined {
	return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as T | undefined;
}

/** Remove the service from globalThis (call on shutdown/reload). */
export function unpublishSubagentsService(): void {
	// eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Symbol-keyed global property; Map.delete() is not applicable
	delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}
