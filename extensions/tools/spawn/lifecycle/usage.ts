/** usage.ts — Token usage: shapes, accumulator operators, session-stats readers. */

import type { UsageTotals } from "../../../../shared/usage.ts";

/**
 * Lifetime usage components, accumulated via `message_end` events. Survives
 * compaction (which replaces session.state.messages and would reset any
 * stats-derived sum).
 *
 * cacheRead is excluded from displayed token totals because each turn's
 * cacheRead is the cumulative cached prefix re-read on that one call — summing
 * across turns counts the prefix N times. It is accumulated here only so the
 * spawn renderers can reproduce the footer's cache-hit rate, which needs the
 * whole prompt (fresh input + cacheRead + cacheWrite). `getLifetimeTotal`
 * deliberately still excludes it, so displayed token totals do not change.
 * See issue #38.
 */
export type LifetimeUsage = {
  input: number;
  /** The most recent turn's fresh input, as `shared/usage.ts` does, so the shared usage group reads the same on both surfaces. */
  lastInput: number;
  output: number;
  /** The most recent turn's output, as `shared/usage.ts` does, so the shared usage group reads the same on both surfaces. */
  lastOutput: number;
  cacheRead: number;
  /** The most recent turn's cache read, so the cache-hit rate matches the footer's latest-turn rate. */
  lastCacheRead: number;
  cacheWrite: number;
  /** The most recent turn's cache write, so the cache-hit rate matches the footer's latest-turn rate. */
  lastCacheWrite: number;
  cost: number;
};

/** Sum of lifetime usage components, or 0 if undefined. */
export function getLifetimeTotal(u?: LifetimeUsage): number {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

/** Add a usage delta into a target accumulator (mutates target). */
export function addUsage(into: LifetimeUsage, delta: LifetimeUsage): void {
  into.input += delta.input;
  into.lastInput = delta.lastInput;
  into.output += delta.output;
  into.lastOutput = delta.lastOutput;
  into.cacheRead += delta.cacheRead;
  into.lastCacheRead = delta.lastCacheRead;
  into.cacheWrite += delta.cacheWrite;
  into.lastCacheWrite = delta.lastCacheWrite;
  into.cost += delta.cost;
}

/** Project the accumulated lifetime components onto the shared `UsageTotals` shape. */
export function toUsageTotals(u: LifetimeUsage): UsageTotals {
  // Mirror the footer's cache-hit rate: the latest turn's cache read over that
  // turn's whole prompt. `entries` keys the footer's recompute cache and is
  // meaningless for a spawn, so it stays 0.
  const latestPromptTokens = u.lastInput + u.lastCacheRead + u.lastCacheWrite;
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    cost: u.cost,
    cacheHitRate: latestPromptTokens > 0 ? (u.lastCacheRead / latestPromptTokens) * 100 : 0,
    entries: 0,
  };
}

/** Minimal shape we read from upstream `getSessionStats()`. */
export type SessionStatsLike = {
  tokens: { input: number; output: number; cacheWrite: number };
  contextUsage?: { percent: number | null };
};
export type SessionLike = { getSessionStats(): SessionStatsLike };

/**
 * Session-scoped token count: input + output + cacheWrite as reported by
 * upstream `getSessionStats().tokens` for the *current* session window.
 *
 * RESETS at compaction — upstream replaces `session.state.messages` and the
 * stats are derived from that array. For a lifetime total that survives
 * compaction, use `getLifetimeTotal(lifetimeUsage)` instead, which reads
 * from an independent accumulator fed by `message_end` events.
 *
 * Avoids upstream's `tokens.total` field, which sums per-turn `cacheRead`
 * and so counts the cumulative cached prefix N times across N turns
 * (issue #38).
 */
export function getSessionTokens(session: SessionLike | undefined): number {
  if (!session) return 0;
  try {
    const t = session.getSessionStats().tokens;
    return t.input + t.output + t.cacheWrite;
  } catch { return 0; }
}

/**
 * Context-window utilization (0–100), or null when unavailable
 * (no model contextWindow, or post-compaction before the next response).
 */
export function getSessionContextPercent(session: SessionLike | undefined): number | null {
  if (!session) return null;
  try { return session.getSessionStats().contextUsage?.percent ?? null; }
  catch { return null; }
}
