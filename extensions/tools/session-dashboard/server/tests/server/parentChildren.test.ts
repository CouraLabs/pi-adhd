// tests/server/parentChildren.test.ts
// Exercises the parent->children reverse index (byParent) and the
// GET /api/sessions/:id/children endpoint added in step 6.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { SessionIndex, createHandler } from "../../server";
import { makeSession } from "../helpers/makeSession";

async function startServer(sessionsDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const handler = createHandler({ sessionsDir, serveStatic: false });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const port = addr.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("SessionIndex parent->children reverse index", () => {
  it("rebuild() populates byParent with multiple children of one parent", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-children-"));
    makeSession(root, { cwd: "/proj/child1", sessionId: "child-1", parentMarker: "parent-123" });
    makeSession(root, { cwd: "/proj/child2", sessionId: "child-2", parentMarker: "parent-123" });
    makeSession(root, { cwd: "/proj/child3", sessionId: "child-3", parentMarker: "parent-456" });
    makeSession(root, { cwd: "/proj/solo", sessionId: "solo" });

    const index = new SessionIndex(root);
    await index.rebuild();

    // readdir order is filesystem-dependent; sort before asserting.
    expect((await index.getChildren("parent-123")).sort()).toEqual(["child-1", "child-2"]);
    expect(await index.getChildren("parent-456")).toEqual(["child-3"]);
    // A session without a marker is never registered under any parent.
    expect(await index.getChildren("solo")).toEqual([]);
  });

  it("getChildren() returns [] for a non-existent parent", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-children-"));
    makeSession(root, { cwd: "/proj/a", sessionId: "a", parentMarker: "parent-a" });

    const index = new SessionIndex(root);
    await index.rebuild();

    expect(await index.getChildren("no-such-parent")).toEqual([]);
    expect(await index.getChildren("parent-a")).toEqual(["a"]);
  });

  it("returns children for a parent via HTTP endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-children-"));
    makeSession(root, { cwd: "/proj/p", sessionId: "parent-1" });
    makeSession(root, { cwd: "/proj/c1", sessionId: "child-1", parentMarker: "parent-1" });
    makeSession(root, { cwd: "/proj/c2", sessionId: "child-2", parentMarker: "parent-1" });

    const { url, close } = await startServer(root);
    try {
      const res = await fetch(`${url}/api/sessions/parent-1/children`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { parent: string; children: string[] };
      expect(body.parent).toBe("parent-1");
      expect(body.children.sort()).toEqual(["child-1", "child-2"]);
    } finally {
      await close();
    }
  });

  it("returns 200 with empty children for a session with no children via HTTP endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-children-"));
    makeSession(root, { cwd: "/proj/solo", sessionId: "solo" });

    const { url, close } = await startServer(root);
    try {
      const res = await fetch(`${url}/api/sessions/solo/children`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { parent: string; children: string[] };
      expect(body).toEqual({ parent: "solo", children: [] });
    } finally {
      await close();
    }
  });

  it("returns 404 for an unknown session id via HTTP endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-children-"));
    makeSession(root, { cwd: "/proj/a", sessionId: "known" });

    const { url, close } = await startServer(root);
    try {
      const res = await fetch(`${url}/api/sessions/no-such-id/children`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body).toEqual({ error: "session not found" });
    } finally {
      await close();
    }
  });
});