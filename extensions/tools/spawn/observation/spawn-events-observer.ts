import type { SpawnManagerObserver } from "../lifecycle/spawn-manager.ts";
import { SPAWN_RECORD_ENTRY, toPersistedRecord } from "../persisted-record.ts";
import { SUBAGENT_USAGE_ENTRY, toSubagentUsage } from "../../../../shared/subagent-usage.ts";
import type { CompactionInfo, Spawn } from "../types.ts";

export type EventEmit = (channel: string, data: unknown) => void;

export type AppendEntry = (customType: string, data: unknown) => void;

export interface SpawnEventsObserverDeps {
	emit: EventEmit;
	appendEntry: AppendEntry;
}

export class SpawnEventsObserver implements SpawnManagerObserver {
	private readonly emit: EventEmit;
	private readonly appendEntry: AppendEntry;

	constructor(deps: SpawnEventsObserverDeps) {
		this.emit = deps.emit;
		this.appendEntry = deps.appendEntry;
	}

	onSpawnStarted(record: Spawn): void {

		this.emit("spawn:started", {
			id: record.id,
			type: record.type,
			description: record.description,
		});
	}

	onSpawnCompleted(record: Spawn): void {

		const isError = record.isTerminalError();
		const eventData = buildEventData(record);
		if (isError) {
			this.emit("spawn:failed", eventData);
		} else {
			this.emit("spawn:completed", eventData);
		}

		this.persist(record);
	}

	onSpawnResuming(record: Spawn): void {
		this.emit("spawn:resuming", {
			id: record.id,
			type: record.type,
			description: record.description,
		});
	}

	onSpawnResumed(record: Spawn): void {

		this.emit("spawn:resumed", buildEventData(record));
		this.persist(record);
	}

	private persist(record: Spawn): void {
		this.appendEntry(SPAWN_RECORD_ENTRY, toPersistedRecord(record));
		this.appendEntry(SUBAGENT_USAGE_ENTRY, toSubagentUsage(record));
	}

	onSpawnCompacted(record: Spawn, info: CompactionInfo): void {

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
