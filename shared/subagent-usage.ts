export const SUBAGENT_USAGE_ENTRY = "subagent-usage";

export interface PersistedSubagentUsage {

	readonly id: string;
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;

	readonly cost: number;
}

export interface SubagentUsageComponents {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: number;
}

export interface SubagentUsageEntryLike {
	readonly type: string;
	readonly customType?: string;
	readonly data?: unknown;
}

export interface SubagentUsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

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
