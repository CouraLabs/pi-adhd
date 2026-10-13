/**
 * record-observer.ts — Subscribes to session events and accumulates SpawnState stats.
 *
 * The observer targets the SpawnState value object directly, so it carries
 * no dependency on Spawn; the caller forwards itself to its own lifecycle
 * observer via onCompact.
 */

import type { SpawnState } from "./spawn-state.ts";
import type { CompactionInfo, SubscribableSession } from "../types.ts";

export interface SpawnObserverOptions {
  onCompact?: (info: CompactionInfo) => void;
}

/**
 * Subscribe to session events and accumulate stats on the spawn state.
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
export function subscribeSpawnObserver(
  session: SubscribableSession,
  state: SpawnState,
  options?: SpawnObserverOptions,
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
        lastCacheRead: u.cacheRead,
        cacheWrite: u.cacheWrite,
        lastCacheWrite: u.cacheWrite,
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
