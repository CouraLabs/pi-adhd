// tests/client/stats.test.ts
// Unit tests for computeSessionStats (client-side mirror).
import { describe, it, expect } from "vitest";
import { computeSessionStats } from "../../src/lib/stats";
import type { SessionEntry } from "../../src/types";

interface AsstOpts {
  usage?: unknown;
  model?: string;
  timestamp?: string;
}

function asst(id: string, parentId: string | null, opts: AsstOpts = {}): SessionEntry {
  const message: Record<string, unknown> = {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
    timestamp: 0,
    usage: opts.usage,
  };
  if (opts.model !== undefined) message.model = opts.model;
  return {
    type: "message",
    id,
    parentId,
    timestamp: opts.timestamp ?? "2026-01-01T00:00:00.000Z",
    message,
  } as unknown as SessionEntry;
}

function toolResult(id: string, parentId: string | null, toolName: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "tc_" + id,
      toolName,
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: 0,
    },
  } as SessionEntry;
}

function user(id: string, parentId: string | null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
  } as SessionEntry;
}

function compaction(id: string, parentId: string | null): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary: "summarized",
    firstKeptEntryId: id,
    tokensBefore: 1000,
  } as SessionEntry;
}

describe("computeSessionStats", () => {
  it("empty branch: all zeros, null timestamps, null latestModel", () => {
    const s = computeSessionStats([]);
    expect(s).toEqual({
      latestContextTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      turns: 0,
      toolCalls: 0,
      agentCalls: 0,
      compactions: 0,
      lastTimestamp: null,
      firstTimestamp: null,
      latestModel: null,
      cacheHitPercent: 0,
    });
  });

  it("no assistant messages: token sums 0, turns 0, timestamps set", () => {
    const branch = [toolResult("b", "a", "read"), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.latestContextTokens).toBe(0);
    expect(s.totalInputTokens).toBe(0);
    expect(s.totalOutputTokens).toBe(0);
    expect(s.turns).toBe(0);
    expect(s.toolCalls).toBe(1);
    expect(s.agentCalls).toBe(0);
    expect(s.compactions).toBe(0);
    expect(s.lastTimestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(s.firstTimestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(s.latestModel).toBeNull();
  });

  it("assistant with full usage: all fields populated, latestContextTokens === totalTokens", () => {
    const branch = [
      asst("b", "a", {
        usage: { input: 100, output: 200, cacheRead: 50, cacheWrite: 50, totalTokens: 400, cost: { total: 0 } },
      }),
      user("a", null),
    ];
    const s = computeSessionStats(branch);
    expect(s.turns).toBe(1);
    expect(s.totalInputTokens).toBe(100);
    expect(s.totalOutputTokens).toBe(200);
    expect(s.latestContextTokens).toBe(400);
    expect(s.latestModel).toBeNull();
  });

  it("assistant with usage: null: token sums unchanged, turns still increments", () => {
    const branch = [asst("b", "a", { usage: null }), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.turns).toBe(1);
    expect(s.totalInputTokens).toBe(0);
    expect(s.totalOutputTokens).toBe(0);
    expect(s.latestContextTokens).toBe(0);
  });

  it("assistant with usage: {}: zeros everywhere", () => {
    const branch = [asst("b", "a", { usage: {} }), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.turns).toBe(1);
    expect(s.totalInputTokens).toBe(0);
    expect(s.totalOutputTokens).toBe(0);
    expect(s.latestContextTokens).toBe(0);
  });

  it("usage without totalTokens falls back to input+output+cacheRead+cacheWrite", () => {
    const branch = [asst("b", "a", { usage: { input: 100, output: 200, cacheRead: 50, cacheWrite: 50 } }), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.latestContextTokens).toBe(400);
  });

  it("totalTokens wins when > 0", () => {
    const branch = [asst("b", "a", { usage: { input: 100, output: 0, totalTokens: 50 } }), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.latestContextTokens).toBe(50);
  });

  it("multiple assistants with different models: newest model wins, count is the consecutive run from the leaf", () => {
    // Leaf-first: a1 (M3, newest), a2 (M3), a3 (M2, breaks the run), a4 (M3, oldest).
    const branch = [
      asst("a1", "a2", { model: "M3", usage: { input: 10, output: 1, totalTokens: 11 } }),
      asst("a2", "a3", { model: "M3", usage: { input: 20, output: 2, totalTokens: 22 } }),
      asst("a3", "a4", { model: "M2", usage: { input: 30, output: 3, totalTokens: 33 } }),
      asst("a4", null, { model: "M3", usage: { input: 40, output: 4, totalTokens: 44 } }),
    ];
    const s = computeSessionStats(branch);
    expect(s.turns).toBe(4);
    expect(s.totalInputTokens).toBe(100);
    expect(s.totalOutputTokens).toBe(10);
    expect(s.latestContextTokens).toBe(11);
    expect(s.latestModel).toEqual({ model: "M3", turns: 2 });
  });

  it('toolResult with toolName "call": counted in both toolCalls and agentCalls', () => {
    const branch = [toolResult("b", "a", "call"), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.toolCalls).toBe(1);
    expect(s.agentCalls).toBe(1);
  });

  it('toolResult with toolName "bash": counted in toolCalls only', () => {
    const branch = [toolResult("b", "a", "bash"), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.toolCalls).toBe(1);
    expect(s.agentCalls).toBe(0);
  });

  it("toolResult with other toolNames: counted in toolCalls only", () => {
    const branch = [
      toolResult("c", "b", "read"),
      toolResult("b", "a", "edit"),
      user("a", null),
    ];
    const s = computeSessionStats(branch);
    expect(s.toolCalls).toBe(2);
    expect(s.agentCalls).toBe(0);
  });

  it("compaction entries counted in compactions", () => {
    const branch = [asst("c", "b", { usage: { input: 1, output: 1, totalTokens: 2 } }), compaction("b", "a"), user("a", null)];
    const s = computeSessionStats(branch);
    expect(s.compactions).toBe(1);
    expect(s.turns).toBe(1);
  });

  it("leaf-first order: latest context comes from branch[0]", () => {
    const branch = [
      asst("a1", "a2", { usage: { input: 60, output: 40, totalTokens: 100 } }),
      asst("a2", null, { usage: { input: 400, output: 100, totalTokens: 500 } }),
    ];
    const s = computeSessionStats(branch);
    expect(s.latestContextTokens).toBe(100);
    expect(s.totalInputTokens).toBe(460);
    expect(s.totalOutputTokens).toBe(140);
  });

  it("timestamps: null on empty branch; same value on single entry", () => {
    expect(computeSessionStats([]).lastTimestamp).toBeNull();
    expect(computeSessionStats([]).firstTimestamp).toBeNull();

    const single = [user("a", null)];
    const s = computeSessionStats(single);
    expect(s.lastTimestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(s.firstTimestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("cache hit: empty branch -> 0", () => {
    expect(computeSessionStats([]).cacheHitPercent).toBe(0);
  });

  it("cache hit: only cacheRead, zero input -> 100", () => {
    const branch = [
      asst("a1", null, { usage: { input: 0, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 105 } }),
    ];
    expect(computeSessionStats(branch).cacheHitPercent).toBe(100);
  });

  it("cache hit: mix of input and cacheRead -> correct percentage", () => {
    const branch = [
      asst("a1", null, { usage: { input: 100, output: 1, cacheRead: 50, cacheWrite: 0, totalTokens: 151 } }),
      asst("a2", "a1", { usage: { input: 200, output: 1, cacheRead: 50, cacheWrite: 0, totalTokens: 251 } }),
    ];
    expect(computeSessionStats(branch).cacheHitPercent).toBe(25);
  });

  it("cache hit: rounds to nearest integer", () => {
    const a = asst("a1", null, { usage: { input: 2, output: 1, cacheRead: 1, cacheWrite: 0, totalTokens: 4 } });
    const b = asst("a2", "a1", { usage: { input: 0, output: 0, cacheRead: 2, cacheWrite: 0, totalTokens: 2 } });
    expect(computeSessionStats([a]).cacheHitPercent).toBe(33);
    expect(computeSessionStats([a, b]).cacheHitPercent).toBe(60);
  });
});
