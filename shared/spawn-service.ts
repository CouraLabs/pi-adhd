const SERVICE_KEY = Symbol.for("@couralabs/pi-adhd/spawn");

export interface SpawnUsageRecord {
	lifetimeUsage?: { cost?: number };
}

export interface SpawnServiceConsumer {
	listAgents(): readonly SpawnUsageRecord[];
}

export function publishSpawnService(service: unknown): void {
	const store = globalThis as Record<symbol, unknown>;

	if (store[SERVICE_KEY] === undefined) store[SERVICE_KEY] = service;
}

export function getSpawnService<T = unknown>(): T | undefined {
	return (globalThis as Record<symbol, unknown>)[SERVICE_KEY] as T | undefined;
}

export function unpublishSpawnService(): void {

	delete (globalThis as Record<symbol, unknown>)[SERVICE_KEY];
}
