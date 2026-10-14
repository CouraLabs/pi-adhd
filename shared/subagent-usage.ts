/**
 * subagent-usage — the session-entry contract for persisted subagent usage.
 *
 * Every terminal spawn run appends a `subagent-usage` custom entry to the
 * parent session carrying that record's cumulative usage, so the session file
 * outlives the in-memory `SpawnManager` (a `/reload` rebuilds the extension; a
 * `/resume` reopens the file). The footer reads the entries through
 * `computeUsage`, so a reopened session still shows what its subagents spent —
 * the live `SpawnService` does not survive either of those.
 *
 * This module owns the entry's shape on both sides: the writer
 * (`SpawnEventsObserver`) builds the payload here, and `computeUsage` parses it
 * here. It lives in `shared` so the reader needs no dependency on the spawn
 * package.
 */

/** The `customType` every persisted subagent usage entry is appended under. */
export const SUBAGENT_USAGE_ENTRY = "subagent-usage";

/** What is appended for one terminal run: the record's cumulative usage. */
export interface PersistedSubagentUsage {
	/** The spawn record's id. Resumed runs re-append under the same id. */
	readonly id: string;
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	/** The record's cumulative cost, as `LifetimeUsage.cost` reports it. */
	readonly cost: number;
}

/** The usage components a writer reads off a spawn record. Optional so a record persisted before a field existed still validates. */
export interface SubagentUsageComponents {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
}

/** The session-entry fields the reader inspects; Pi's `SessionEntry` satisfies it. */
export interface SubagentUsageEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

/** The usage components a reader sums across records. */
export interface SubagentUsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/**
 * Build the entry payload for one terminal run. The record is taken
 * structurally — only `id` and its lifetime usage are read — so the spawn
 * package's `Spawn` type satisfies it without this module importing it.
 */
export function toSubagentUsage(record: {
	id: string;
	lifetimeUsage?: SubagentUsageComponents;
}): PersistedSubagentUsage {
	const usage = record.lifetimeUsage;
	return {
		id: record.id,
		input: usage?.input ?? 0,
		output: usage?.output ?? 0,
		cacheRead: usage?.cacheRead ?? 0,
		cacheWrite: usage?.cacheWrite ?? 0,
		cost: usage?.cost ?? 0,
	};
}

/**
 * Read every persisted subagent usage out of a session's entries and sum it.
 *
 * A resumed run appends a second entry under the same id carrying the record's
 * new cumulative total, so the last entry per agent id wins and the sum across
 * ids never counts one agent twice.
 */
export function readSubagentUsage(entries: readonly SubagentUsageEntryLike[]): SubagentUsageTotals {
	const latest = new Map<string, PersistedSubagentUsage>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== SUBAGENT_USAGE_ENTRY) continue;
		const usage = asSubagentUsage(entry.data);
		if (usage) latest.set(usage.id, usage);
	}
	const totals: SubagentUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	for (const usage of latest.values()) {
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost;
	}
	return totals;
}

function asSubagentUsage(data: unknown): PersistedSubagentUsage | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { id, input, output, cacheRead, cacheWrite, cost } = data as Record<string, unknown>;
	if (typeof id !== "string") return undefined;
	if (typeof input !== "number" || typeof output !== "number" || typeof cacheRead !== "number") return undefined;
	if (typeof cacheWrite !== "number" || typeof cost !== "number") return undefined;
	return { id, input, output, cacheRead, cacheWrite, cost };
}
