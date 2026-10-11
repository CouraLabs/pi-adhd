import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntries } from "../../shared/usage.ts";

/**
 * Rebuild the turn/tool counters from a loaded session branch so resumed
 * sessions show real numbers.
 */
export function countHistory(entries: SessionEntries): { turns: number; tools: number } {
	let turns = 0;
	let tools = 0;
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as Message;
		if (message.role === "assistant") {
			turns++;
		} else if (message.role === "toolResult") {
			// Match the live counter, which also counts nested tool executions.
			tools += 1 + (message.nestedCalls?.calls.length ?? 0);
		}
	}
	return { turns, tools };
}
