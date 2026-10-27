import type { UsageTotals } from "../../../../shared/usage.ts";

export type LifetimeUsage = {
  input: number;

  lastInput: number;
  output: number;

  lastOutput: number;
  cacheRead: number;

  lastCacheRead: number;
  cacheWrite: number;

  lastCacheWrite: number;
  cost: number;
};

export function getLifetimeTotal(u?: LifetimeUsage): number {
  return u ? u.input + u.output + u.cacheWrite : 0;
}

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

export function toUsageTotals(u: LifetimeUsage): UsageTotals {

  const latestPromptTokens = u.lastInput + u.lastCacheRead + u.lastCacheWrite;
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    cost: u.cost,
    cacheHitRate: latestPromptTokens > 0 ? (u.lastCacheRead / latestPromptTokens) * 100 : 0,
    entries: 0,
    subagentCost: 0,
  };
}

export type SessionStatsLike = {
  contextUsage?: { percent: number | null };
};
export type SessionLike = { getSessionStats(): SessionStatsLike };

export function getSessionContextPercent(session: SessionLike | undefined): number | null {
  if (!session) return null;
  try { return session.getSessionStats().contextUsage?.percent ?? null; }
  catch { return null; }
}
