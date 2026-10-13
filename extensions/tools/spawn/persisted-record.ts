/**
 * persisted-record.ts — The `spawn:record` session-entry contract.
 *
 * Each terminal run is appended to the parent session as a custom entry, so the
 * session file outlives the in-memory `SpawnManager` (a `/reload` rebuilds
 * the extension; a `/resume` reopens the file). This module owns the entry's
 * shape on both sides: the writer (`SpawnEventsObserver`) builds it here,
 * and readers parse it here.
 */

import type { SpawnStatus } from "./lifecycle/spawn-state.ts";
import type { TurnBudget } from "./lifecycle/turn-limits.ts";
import type { SpawnType } from "./types.ts";

/** The `customType` every persisted run record is appended under. */
export const SPAWN_RECORD_ENTRY = "spawn:record";

/** What is appended for each terminal run. */
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
	/** The run's session JSONL, which a reader can open after the live session is gone. */
	readonly outputFile: string | undefined;
	readonly toolUses: number;
}

/** The fields a reader validates and returns: what labels a past run and opens its transcript. */
export type PersistedRunSummary = Pick<
	PersistedSpawnRecord,
	"id" | "type" | "description" | "status" | "startedAt" | "completedAt" | "toolUses" | "outputFile"
>;

/** The session-entry fields the reader inspects; Pi's `SessionEntry` satisfies it. */
export interface SessionEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

/**
 * Build the entry for one terminal run. A `Spawn` satisfies the parameter
 * structurally; copying field by field keeps everything else off the entry.
 */
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

/**
 * Read every persisted run out of a session's entries, newest first.
 *
 * A resumed run appends a second entry under the same id, so the last one wins.
 * Entries that do not validate are skipped, including those written before the
 * entry recorded `toolUses`.
 */
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
