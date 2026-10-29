// tests/server/listSessions.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, createHandler } from "../../server";
import { makeSession } from "../helpers/makeSession";

function touchMtime(filepath: string, mtime: Date): void {
  utimesSync(filepath, mtime, mtime);
}

describe("listSessions", () => {
  it("returns [] when the sessions dir is missing", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sdb-list-")), "missing");
    const result = await listSessions(dir);
    expect(result).toEqual([]);
  });

  it("lists 3 sessions sorted by lastActivity desc", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-list-"));

    const a = makeSession(root, { cwd: "/proj/a", messages: [{ role: "user", content: "first A message" }] });
    // makeSession creates the cwd subdir; we want to vary mtime.
    const oldMtime = new Date("2026-01-01T10:00:00Z");
    const midMtime = new Date("2026-01-02T10:00:00Z");
    const newMtime = new Date("2026-01-03T10:00:00Z");
    touchMtime(a.filepath, oldMtime);

    const b = makeSession(root, { cwd: "/proj/b", messages: [{ role: "user", content: "first B message" }] });
    touchMtime(b.filepath, newMtime);

    const c = makeSession(root, { cwd: "/proj/c", messages: [{ role: "user", content: "first C message" }] });
    touchMtime(c.filepath, midMtime);

    const list = await listSessions(root);
    expect(list.length).toBe(3);
    // Sorted by lastActivity desc: b, c, a
    expect(list[0].cwd).toBe("/proj/b");
    expect(list[1].cwd).toBe("/proj/c");
    expect(list[2].cwd).toBe("/proj/a");
    // Each has a preview of its first user message.
    expect(list[0].preview).toBe("first B message");
    expect(list[1].preview).toBe("first C message");
    expect(list[2].preview).toBe("first A message");
  });

  it("truncates preview to 200 chars", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-list-"));
    const long = "x".repeat(500);
    makeSession(root, { cwd: "/proj/long", messages: [{ role: "user", content: long }] });
    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].preview.length).toBe(200);
  });

  it("records the session_info name on list output", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-list-"));
    makeSession(root, { cwd: "/proj/named", name: "My special session" });
    const list = await listSessions(root);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("My special session");
  });

  it("returns session list via HTTP handler", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-list-"));
    makeSession(root, { cwd: "/proj/http", messages: [{ role: "user", content: "via http" }] });

    const handler = createHandler({ sessionsDir: root, serveStatic: false });
    const { createServer } = await import("node:http");
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    const port = addr.port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/sessions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ cwd: string; preview: string }>;
      expect(body.length).toBe(1);
      expect(body[0].cwd).toBe("/proj/http");
      expect(body[0].preview).toBe("via http");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
