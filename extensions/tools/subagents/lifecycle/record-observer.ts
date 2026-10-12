/**
 * record-observer.ts — Subscribes to session events and accumulates SubagentState stats.
 *
 * The observer targets the SubagentState value object directly, so it carries
 * no dependency on Subagent; the caller forwards itself to its own lifecycle
 * observer via onCompact.
 */

import type { SubagentState } from "./subagent-state.ts";
import type { CompactionInfo, SubscribableSession } from "../types.ts";

export interface SubagentObserverOptions {
  onCompact?: (info: CompactionInfo) => void;
}

/**
 * Subscribe to session events and accumulate stats on the subagent state.
 *
 * Handles:
 * - every event → `state.markProgress()`, so a run whose events stop reads as stalled
 * - `tool_execution_start` → `state.addActiveTool(name)`
 * - `tool_execution_end` → `state.removeActiveTool(name)`, `state.incrementToolUses()`
 * - `message_start` → `state.resetResponseText()`
 * - `message_update` (text_delta) → `state.appendResponseText(delta)`
 * - `message_end` (assistant, with usage) → `state.addUsage(…)`
 * - `compaction_end` (not aborted) → `state.incrementCompactions()`, call `onCompact`
 *
 * @returns An unsubscribe function.
 */
export function subscribeSubagentObserver(
  session: SubscribableSession,
  state: SubagentState,
  options?: SubagentObserverOptions,
): () => void {
  return session.subscribe((event) => {
    state.markProgress();

    if (event.type === "tool_execution_start") {
      state.addActiveTool(event.toolName);
    }

    if (event.type === "tool_execution_end") {
      state.removeActiveTool(event.toolName);
      state.incrementToolUses();
    }

    if (event.type === "message_start") {
      state.resetResponseText();
    }

    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      state.appendResponseText(event.assistantMessageEvent.delta);
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const u = event.message.usage;
      state.addUsage({
        input: u.input,
        lastInput: u.input,
        output: u.output,
        lastOutput: u.output,
        cacheRead: u.cacheRead,
        cacheWrite: u.cacheWrite,
        cost: u.cost?.total ?? 0,
      });
    }

    if (event.type === "compaction_end" && !event.aborted && event.result) {
      state.incrementCompactions();
      options?.onCompact?.({
        reason: event.reason,
        tokensBefore: event.result.tokensBefore,
      });
    }
  });
}
