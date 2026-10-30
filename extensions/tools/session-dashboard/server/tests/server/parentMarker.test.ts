// tests/server/parentMarker.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions } from "../../server";
import { makeSession } from "../helpers/makeSession";

describe("parent marker (agent-xpto-parent)", () => {
  it("omits parentSession when no marker is present", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-parent-"));
    makeSession(root, { cwd: "/proj/plain", messages: [{ role: "user", content: "hello" }] });

    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].parentSession).toBeUndefined();
    expect("parentSession" in list[0]).toBe(false);
  });

  it("reports data.parentSessionId when the marker is present", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-parent-"));
    const { id } = makeSession(root, {
      cwd: "/proj/child",
      messages: [{ role: "user", content: "hello parent" }],
      parentMarker: "parent-session-123",
    });
    expect(id.length).toBeGreaterThan(0);

    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].parentSession).toBe("parent-session-123");
  });

  it("detects the marker even when it appears after the first message", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-parent-"));
    makeSession(root, {
      cwd: "/proj/late",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
      parentMarker: "late-parent-session",
    });

    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].parentSession).toBe("late-parent-session");
  });

  it("does not confuse other custom entries for the marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-parent-"));
    const cwd = "/proj/other";
    const encoded = "--" + cwd.replace(/^\//, "").replace(/\/$/, "").replace(/\//g, "-") + "--";
    const dir = join(root, encoded);
    mkdirSync(dir, { recursive: true });
    const id = "custom-entry-session";
    const filepath = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    writeFileSync(
      filepath,
      [
        JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd }),
        JSON.stringify({
          type: "custom",
          id: "cafef00d",
          parentId: null,
          timestamp: "2026-01-01T00:00:00.000Z",
          customType: "somethingElse",
          data: { parentSessionId: "should-not-match", foo: "bar" },
        }),
        "",
      ].join("\n"),
      "utf8",
    );

    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].parentSession).toBeUndefined();
    expect("parentSession" in list[0]).toBe(false);
  });
});