import type { SpawnState } from "./spawn-state.ts";
import type { CompactionInfo, SubscribableSession } from "../types.ts";

export interface SpawnObserverOptions {
  onCompact?: (info: CompactionInfo) => void;
}

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
