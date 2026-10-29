// tests/server/walkActiveBranch.test.ts
import { describe, it, expect } from "vitest";
import { walkActiveBranch } from "../../server";
import type { SessionEntry } from "../../server";

function msg(id: string, parentId: string | null, role: "user" | "assistant", text: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: {
      role,
      content: [{ type: "text", text }],
      timestamp: 0,
    },
  };
}

function meta(id: string, parentId: string | null, type: SessionEntry["type"]): SessionEntry {
  return {
    type,
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    provider: "x",
    modelId: "y",
    thinkingLevel: "off",
    summary: "...",
    firstKeptEntryId: id,
    tokensBefore: 0,
    label: "l",
    customType: "t",
    data: {},
    content: "",
    display: false,
    name: "n",
  } as unknown as SessionEntry;
}

describe("walkActiveBranch", () => {
  it("returns the linear chain leaf-first", () => {
    // A -> B -> C -> D -> E
    const entries: SessionEntry[] = [
      msg("a1", null, "user", "hi"),
      msg("a2", "a1", "assistant", "hello"),
      msg("a3", "a2", "user", "q"),
      msg("a4", "a3", "assistant", "a"),
      msg("a5", "a4", "user", "bye"),
    ];
    const branch = walkActiveBranch(entries);
    expect(branch.map((e) => e.id)).toEqual(["a5", "a4", "a3", "a2", "a1"]);
  });

  it("picks the highest-id leaf deterministically when branched", () => {
    // Root -> A -> (B1, B2); both leaves independent, B2 id > B1 id.
    const entries: SessionEntry[] = [
      msg("aaaa01", null, "user", "root"),
      msg("aaaa02", "aaaa01", "assistant", "a"),
      msg("bbbb01", "aaaa02", "user", "b1"), // branch 1
      msg("bbbb02", "aaaa02", "user", "b2"), // branch 2 (higher id)
    ];
    const branch = walkActiveBranch(entries);
    // Should walk from bbbb02 -> aaaa02 -> aaaa01
    expect(branch.map((e) => e.id)).toEqual(["bbbb02", "aaaa02", "aaaa01"]);
  });

  it("excludes orphaned entries", () => {
    const entries: SessionEntry[] = [
      msg("00000001", null, "user", "root"),
      msg("00000002", "00000001", "user", "child"),
      msg("deadbeef", "ffffffff", "user", "orphan"), // parent doesn't exist
    ];
    const branch = walkActiveBranch(entries);
    expect(branch.map((e) => e.id)).toEqual(["00000002", "00000001"]);
    expect(branch.find((e) => e.id === "deadbeef")).toBeUndefined();
  });

  it("handles a single entry", () => {
    const entries: SessionEntry[] = [msg("00000001", null, "user", "lonely")];
    const branch = walkActiveBranch(entries);
    expect(branch.map((e) => e.id)).toEqual(["00000001"]);
  });

  it("ignores the session header entry (it has no parentId and is metadata)", () => {
    const entries: SessionEntry[] = [
      {
        type: "session",
        version: 3,
        id: "11111111-2222-3333-4444-555555555555",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/x",
      } as unknown as SessionEntry,
      msg("00000001", null, "user", "hi"),
      msg("00000002", "00000001", "assistant", "hello"),
    ];
    const branch = walkActiveBranch(entries);
    expect(branch.map((e) => e.id)).toEqual(["00000002", "00000001"]);
    expect(branch.find((e) => e.type === "session")).toBeUndefined();
  });

  it("truncates ancestors when a compaction is on the branch", () => {
    // Chain: a1 -> a2 -> compaction(c1) -> b1 -> b2 (leaf)
    // Walk leaf-first: [b2, b1, c1, a2, a1] -> after compaction handling: [b2, b1, c1]
    const a1 = msg("00000001", null, "user", "old1");
    const a2 = msg("00000002", "00000001", "user", "old2");
    const c1: SessionEntry = {
      type: "compaction",
      id: "00000003",
      parentId: "00000002",
      timestamp: "2026-01-01T00:00:00.000Z",
      summary: "summary",
      firstKeptEntryId: "00000004",
      tokensBefore: 100,
    };
    const b1 = msg("00000004", "00000003", "user", "new1");
    const b2 = msg("00000005", "00000004", "assistant", "new2");
    const branch = walkActiveBranch([a1, a2, c1, b1, b2]);
    expect(branch.map((e) => e.id)).toEqual(["00000005", "00000004", "00000003"]);
    // a1 and a2 must be excluded — they are summarized.
    expect(branch.find((e) => e.id === "00000001")).toBeUndefined();
    expect(branch.find((e) => e.id === "00000002")).toBeUndefined();
  });

  it("works with real-shaped entries including model_change / thinking_level_change", () => {
    // Use the meta() helper to construct non-message entries.
    const entries: SessionEntry[] = [
      meta("10000000", null, "model_change"),
      meta("20000000", "10000000", "thinking_level_change"),
      msg("30000000", "20000000", "user", "hi"),
      msg("40000000", "30000000", "assistant", "hello"),
    ];
    const branch = walkActiveBranch(entries);
    expect(branch.map((e) => e.id)).toEqual(["40000000", "30000000", "20000000", "10000000"]);
  });
});
