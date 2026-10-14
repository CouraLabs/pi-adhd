import type { SpawnManagerObserver } from "../lifecycle/spawn-manager.ts";
import { SPAWN_RECORD_ENTRY, toPersistedRecord } from "../persisted-record.ts";
import { SUBAGENT_USAGE_ENTRY, toSubagentUsage } from "../../../../shared/subagent-usage.ts";
import type { CompactionInfo, Spawn } from "../types.ts";

/** Emit callback — a subset of `pi.events.emit`. */
export type EventEmit = (channel: string, data: unknown) => void;

/** Append callback — a subset of `pi.appendEntry`. */
export type AppendEntry = (customType: string, data: unknown) => void;

export interface SpawnEventsObserverDeps {
	emit: EventEmit;
	appendEntry: AppendEntry;
}

/**
 * Receives agent lifecycle notifications from SpawnManager and dispatches
 * them to two concerns: pi.events lifecycle events and session-entry
 * persistence.
 *
 * Constructed with narrow deps (emit, appendEntry) so both concerns are
 * unit-testable without booting the extension.
 */
export class SpawnEventsObserver implements SpawnManagerObserver {
	private readonly emit: EventEmit;
	private readonly appendEntry: AppendEntry;

	constructor(deps: SpawnEventsObserverDeps) {
		this.emit = deps.emit;
		this.appendEntry = deps.appendEntry;
	}

	onSpawnStarted(record: Spawn): void {
		// Emit started event when agent transitions to running.
		this.emit("spawn:started", {
			id: record.id,
			type: record.type,
			description: record.description,
		});
	}

	onSpawnCompleted(record: Spawn): void {
		// Emit lifecycle event based on terminal status.
		const isError = record.isTerminalError();
		const eventData = buildEventData(record);
		if (isError) {
			this.emit("spawn:failed", eventData);
		} else {
			this.emit("spawn:completed", eventData);
		}

		this.persist(record);
	}

	/**
	 * A settled agent went back to running. Announced only, and on its own
	 * channel: `spawn:started` reports the first run, and a consumer counting
	 * it once per agent must not see it twice. Nothing is persisted — the session
	 * entry records outcomes, and a run that has just begun is not one.
	 */
	onSpawnResuming(record: Spawn): void {
		this.emit("spawn:resuming", {
			id: record.id,
			type: record.type,
			description: record.description,
		});
	}

	onSpawnResumed(record: Spawn): void {
		// A resumed run terminates in any terminal status; a single distinct
		// channel carries them all — the payload's status/error discriminate. Existing
		// spawn:completed/failed subscribers keep their once-per-run semantics.
		this.emit("spawn:resumed", buildEventData(record));
		this.persist(record);
	}

	/**
	 * Persist the terminal record for cross-extension history reconstruction.
	 * Shared by every terminal-state handler (fresh and resumed).
	 *
	 * The record's cumulative usage rides its own `subagent-usage` entry, so the
	 * session file keeps the spend after the live SpawnManager is gone and the
	 * footer can recompute it from the entries alone.
	 */
	private persist(record: Spawn): void {
		this.appendEntry(SPAWN_RECORD_ENTRY, toPersistedRecord(record));
		this.appendEntry(SUBAGENT_USAGE_ENTRY, toSubagentUsage(record));
	}

	onSpawnCompacted(record: Spawn, info: CompactionInfo): void {
		// Emit compacted event when agent's session compacts (preserves count on record).
		this.emit("spawn:compacted", {
			id: record.id,
			type: record.type,
			description: record.description,
			reason: info.reason,
			tokensBefore: info.tokensBefore,
			compactionCount: record.compactionCount,
		});
	}
}

/** The event payload every terminal channel carries. */
function buildEventData(record: Spawn): Record<string, unknown> {
	return {
		id: record.id,
		type: record.type,
		description: record.description,
		status: record.status,
		result: record.result,
		error: record.error,
		outputFile: record.outputFile,
		toolUses: record.toolUses,
	};
}
