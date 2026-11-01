export const AGY_API_ID = "agy-cli";

export const AGY_BASE_URL = "agy-cli://local";

export const AGY_BINARY = process.env.AGY_BIN ?? "agy";

export const AGY_SYNC_ENTRY_TYPE = "agy-conversation";

export interface AgySyncRecord {
	readonly piSessionId: string;
	readonly conversationId: string;
	readonly modelId: string;
}

export function isAgySyncRecord(value: unknown): value is AgySyncRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.piSessionId === "string" &&
		typeof record.conversationId === "string" &&
		typeof record.modelId === "string"
	);
}

export function latestAgySyncRecord(entries: readonly unknown[]): AgySyncRecord | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== AGY_SYNC_ENTRY_TYPE) continue;
		if (isAgySyncRecord(entry.data)) return entry.data;
	}
	return undefined;
}
