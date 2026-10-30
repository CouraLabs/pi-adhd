// tests/server/fixtures.test.ts
// Sanity test: each fixture JSONL parses without errors via iterateSession.
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { iterateSession, parseSessionHeader, walkActiveBranch, readBody } from "../../server";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "sample-sessions");

describe("fixtures", () => {
  it("fixture files exist", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const fname of ["linear-session.jsonl", "branched-session.jsonl", "compacted-session.jsonl"]) {
    it(`${fname} parses cleanly`, async () => {
      const filepath = join(FIXTURES, fname);
      const header = await parseSessionHeader(filepath);
      expect(header.type).toBe("session");
      expect(typeof header.id).toBe("string");

      const entries: import("../../server").SessionEntry[] = [];
      for await (const e of iterateSession(filepath)) entries.push(e);

      // All entries except header have ids & parentIds; ensure no throws.
      expect(entries.length).toBeGreaterThan(0);

      // walkActiveBranch should return a non-empty branch.
      const branch = walkActiveBranch(entries);
      expect(branch.length).toBeGreaterThan(0);
    });
  }

  it("compacted fixture drops older entries past the compaction", async () => {
    const filepath = join(FIXTURES, "compacted-session.jsonl");
    const entries: import("../../server").SessionEntry[] = [];
    for await (const e of iterateSession(filepath)) entries.push(e);
    const branch = walkActiveBranch(entries);
    // The compaction must be present, and nothing older than it should remain.
    const compIdx = branch.findIndex((e) => e.type === "compaction");
    expect(compIdx).toBeGreaterThanOrEqual(0);
    // Branch is leaf-first; compaction at compIdx means everything after compIdx
    // (i.e. older) should have been dropped.
    expect(compIdx).toBe(branch.length - 1);
  });

  describe("stats on the detail payload", () => {
    const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T/;

    function assertTimestampShape(s: { lastTimestamp: string | null; firstTimestamp: string | null }): void {
      expect(s.lastTimestamp).toMatch(ISO_SHAPE);
      expect(s.firstTimestamp).toMatch(ISO_SHAPE);
    }

    it("linear-session stats", async () => {
      const detail = await readBody(join(FIXTURES, "linear-session.jsonl"));
      expect(detail.stats).toEqual({
        latestContextTokens: 220,
        totalInputTokens: 510,
        totalOutputTokens: 47,
        turns: 3,
        toolCalls: 0,
        agentCalls: 0,
        compactions: 0,
        lastTimestamp: expect.any(String),
        firstTimestamp: expect.any(String),
        latestModel: { model: "MiniMax-M2.7", turns: 3 },
        cacheHitPercent: 0,
      });
      assertTimestampShape(detail.stats!);
    });

    it("branched-session stats", async () => {
      const detail = await readBody(join(FIXTURES, "branched-session.jsonl"));
      expect(detail.stats).toEqual({
        latestContextTokens: 116,
        totalInputTokens: 13620,
        totalOutputTokens: 290,
        turns: 3,
        toolCalls: 1,
        agentCalls: 0,
        compactions: 0,
        lastTimestamp: expect.any(String),
        firstTimestamp: expect.any(String),
        latestModel: { model: "MiniMax-M3", turns: 3 },
        cacheHitPercent: 0,
      });
      assertTimestampShape(detail.stats!);
    });

    it("compacted-session stats", async () => {
      // The active branch drops everything older than the compaction, so only
      // the single post-compaction assistant turn is counted.
      const detail = await readBody(join(FIXTURES, "compacted-session.jsonl"));
      expect(detail.stats).toEqual({
        latestContextTokens: 238,
        totalInputTokens: 220,
        totalOutputTokens: 18,
        turns: 1,
        toolCalls: 0,
        agentCalls: 0,
        compactions: 1,
        lastTimestamp: expect.any(String),
        firstTimestamp: expect.any(String),
        latestModel: { model: "MiniMax-M3", turns: 1 },
        cacheHitPercent: 0,
      });
      assertTimestampShape(detail.stats!);
    });
  });
});
