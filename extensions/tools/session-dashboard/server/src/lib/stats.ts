// src/lib/stats.ts
// Client-side copy of the session-stats aggregation.
//
// Server and client run in separate runtimes; both must include an
// identical copy. Keep in sync. See `server/AGENTS.md`.

import type { SessionEntry, SessionStats } from "../types";

/** Coerce a value into a finite number, defaulting to 0. */
function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

/** Defensively read a `usage: unknown` value. Returns null for
 * non-objects (caller skips token aggregation entirely); returns a
 * zeroed object (with `totalTokens` falling back to the field sum when
 * missing/0) for objects with missing or malformed fields. */
function readUsage(u: unknown): Usage | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const input = num(o.input);
  const output = num(o.output);
  const cacheRead = num(o.cacheRead);
  const cacheWrite = num(o.cacheWrite);
  const totalTokensRaw = num(o.totalTokens);
  const totalTokens = totalTokensRaw > 0 ? totalTokensRaw : input + output + cacheRead + cacheWrite;
  return { input, output, cacheRead, cacheWrite, totalTokens };
}

/**
 * Aggregate statistics over a session's active branch.
 *
 * `branch` is leaf-first: the newest entry is at index 0 and the oldest
 * at the end, so the FIRST assistant message encountered while iterating
 * is the newest one on the branch.
 *
 * Pure function: single pass, no I/O, never throws on malformed input.
 */
export function computeSessionStats(branch: SessionEntry[]): SessionStats {
  const stats: SessionStats = {
    latestContextTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    turns: 0,
    toolCalls: 0,
    agentCalls: 0,
    compactions: 0,
    lastTimestamp: branch[0]?.timestamp ?? null,
    firstTimestamp: branch.length > 0 ? branch[branch.length - 1].timestamp : null,
    latestModel: null,
    cacheHitPercent: 0,
  };

  let seenFirstAssistant = false;
  let modelRunBroken = false;
  let totalCacheRead = 0;

  for (const entry of branch) {
    if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "assistant") {
        stats.turns++;
        const usage = readUsage(message.usage);
        if (!seenFirstAssistant) {
          // First assistant in leaf-first order = newest turn. Store its
          // context size once (0 if it has no usable `usage`).
          stats.latestContextTokens = usage ? usage.totalTokens : 0;
          seenFirstAssistant = true;
        }
        if (usage) {
          stats.totalInputTokens += usage.input;
          stats.totalOutputTokens += usage.output;
          totalCacheRead += usage.cacheRead;
        }
        if (typeof message.model === "string" && !modelRunBroken) {
          if (stats.latestModel === null) {
            stats.latestModel = { model: message.model, turns: 1 };
          } else if (stats.latestModel.model === message.model) {
            stats.latestModel.turns++;
          } else {
            // A different (older) model breaks the consecutive run from the
            // leaf backwards; the count is now final.
            modelRunBroken = true;
          }
        }
      } else if (message.role === "toolResult") {
        stats.toolCalls++;
        if (message.toolName === "call") {
          stats.agentCalls++;
        }
      }
      // user / bashExecution messages contribute to nothing.
    } else if (entry.type === "compaction") {
      stats.compactions++;
    }
    // All other entry types are ignored.
  }

  // Cache hit rate: percentage of total input-side tokens that came from
  // cache. Cache reads are part of what the model "sees" alongside fresh
  // input, so the denominator is input + cacheRead.
  const denom = stats.totalInputTokens + totalCacheRead;
  stats.cacheHitPercent = denom > 0 ? Math.round((100 * totalCacheRead) / denom) : 0;

  return stats;
}
