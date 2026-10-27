import type { SpawnStatus } from "./lifecycle/spawn-state.ts";
import type { TurnBudget } from "./lifecycle/turn-limits.ts";
import type { SpawnType } from "./types.ts";

export const SPAWN_RECORD_ENTRY = "spawn:record";

export interface PersistedSpawnRecord {
	readonly id: string;
	readonly type: SpawnType;
	readonly description: string;
	readonly status: SpawnStatus;
	readonly result: string | undefined;
	readonly error: string | undefined;
	readonly turnBudget: TurnBudget | undefined;
	readonly startedAt: number;
	readonly completedAt: number | undefined;

	readonly outputFile: string | undefined;
	readonly toolUses: number;
}

export type PersistedRunSummary = Pick<
	PersistedSpawnRecord,
	"id" | "type" | "description" | "status" | "startedAt" | "completedAt" | "toolUses" | "outputFile"
>;

export interface SessionEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

export function toPersistedRecord(record: PersistedSpawnRecord): PersistedSpawnRecord {
	return {
		id: record.id,
		type: record.type,
		description: record.description,
		status: record.status,
		result: record.result,
		error: record.error,
		turnBudget: record.turnBudget,
		startedAt: record.startedAt,
		completedAt: record.completedAt,
		outputFile: record.outputFile,
		toolUses: record.toolUses,
	};
}

export function readPersistedRuns(entries: readonly SessionEntryLike[]): PersistedRunSummary[] {
	const runs = new Map<string, PersistedRunSummary>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SPAWN_RECORD_ENTRY) continue;
		const run = asRunSummary(entry.data);
		if (run) runs.set(run.id, run);
	}
	return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

const SPAWN_STATUSES: ReadonlySet<string> = new Set<string>([
	"running",
	"completed",
	"aborted",
	"stopped",
	"error",
]);

function asRunSummary(data: unknown): PersistedRunSummary | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { id, type, description, status, startedAt, completedAt, toolUses, outputFile } = data as Record<string, unknown>;
	if (typeof id !== "string" || typeof type !== "string" || typeof description !== "string") return undefined;
	if (typeof status !== "string" || !SPAWN_STATUSES.has(status)) return undefined;
	if (typeof startedAt !== "number" || typeof toolUses !== "number") return undefined;
	if (completedAt !== undefined && typeof completedAt !== "number") return undefined;
	if (outputFile !== undefined && typeof outputFile !== "string") return undefined;
	return { id, type, description, status: status as SpawnStatus, startedAt, completedAt, toolUses, outputFile };
}
