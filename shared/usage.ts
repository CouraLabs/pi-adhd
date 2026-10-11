import type { Message, Usage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The session entries a branch exposes; used to walk usage records. */
export type SessionEntries = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;

/** Cumulative token and cost totals for a session. */
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function emptyUsage(): UsageTotals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function addUsage(totals: UsageTotals, usage: Usage | undefined): void {
	if (!usage) return;
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cost += usage.cost?.total ?? 0;
}

/** Walk a session branch and sum every usage record it contains. */
export function computeUsage(entries: SessionEntries): UsageTotals {
	const totals = emptyUsage();
	for (const entry of entries) {
		if (entry.type === "usage") {
			addUsage(totals, entry.usage);
		} else if (entry.type === "message") {
			const message = entry.message as Message;
			if (message.role === "assistant") addUsage(totals, message.usage);
			else if (message.role === "toolResult" && message.usage) addUsage(totals, message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}
