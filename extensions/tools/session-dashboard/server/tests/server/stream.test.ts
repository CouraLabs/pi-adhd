// tests/server/stream.test.ts
// Exercise the SSE endpoint end-to-end: append a line, observe it streamed.
import { describe, it, expect } from "vitest";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createHandler } from "../../server";
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

async function readSseLines(resp: Response, maxMs: number): Promise<string[]> {
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  const out: string[] = [];
  const start = Date.now();
  // Read until timeout or close.
  // eslint-disable-next-line no-constant-condition
  while (Date.now() - start < maxMs) {
    const timeout = new Promise<{ value: undefined; done: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, done: true }), maxMs - (Date.now() - start)),
    );
    const next = await Promise.race([reader.read(), timeout]);
    if (next.done) break;
    out.push(decoder.decode(next.value, { stream: true }));
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  return out;
}

function parseSseEvents(text: string): { event: string; data: string }[] {
  const out: { event: string; data: string }[] = [];
  for (const block of text.split("\n\n")) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    if (dataLines.length > 0) out.push({ event, data: dataLines.join("\n") });
  }
  return out;
}

describe("SSE stream", () => {
  it("emits a ready event with fromOffset and streams new entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-sse-"));
    const { filepath, id } = makeSession(root, {
      cwd: "/sse/test",
      messages: [{ role: "user", content: "first" }],
    });

    const { url, close } = await startServer(root);
    try {
      const resp = await fetch(`${url}/api/sessions/${id}/stream`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("content-type")).toMatch(/text\/event-stream/);

      // Start reading in the background.
      const readPromise = readSseLines(resp, 3000);

      // Give the connection a moment to be established, then append.
      await new Promise((r) => setTimeout(r, 300));
      appendFileSync(
        filepath,
        JSON.stringify({
          type: "message",
          id: "abcd1234",
          parentId: "00000001",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "appended" }],
            timestamp: 0,
          },
        }) + "\n",
        "utf8",
      );

      const chunks = await readPromise;
      const text = chunks.join("");
      expect(text).toContain("event: ready");
      expect(text).toContain("event: entry");
      expect(text).toContain('"id":"abcd1234"');
      expect(text).toContain("appended");
    } finally {
      await close();
    }
  });

  it("respects ?from=N to skip already-seen bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-sse-"));
    const { filepath, id } = makeSession(root, {
      cwd: "/sse/from",
      messages: [{ role: "user", content: "first" }],
    });

    // Get current file size.
    const { statSync } = await import("node:fs");
    const size = statSync(filepath).size;

    const { url, close } = await startServer(root);
    try {
      const resp = await fetch(`${url}/api/sessions/${id}/stream?from=${size}`);
      expect(resp.status).toBe(200);

      const readPromise = readSseLines(resp, 3000);
      await new Promise((r) => setTimeout(r, 300));
      appendFileSync(
        filepath,
        JSON.stringify({
          type: "label",
          id: "ffff0001",
          parentId: "00000001",
          timestamp: "2026-01-01T00:00:02.000Z",
          label: "tail",
        }) + "\n",
        "utf8",
      );

      const chunks = await readPromise;
      const text = chunks.join("");
      expect(text).toContain(`"fromOffset":${size}`);
      expect(text).toContain('"id":"ffff0001"');
    } finally {
      await close();
    }
  });

  it("emits stats alongside each streamed entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "sdb-sse-"));
    const { filepath, id } = makeSession(root, {
      cwd: "/sse/stats",
      messages: [{ role: "user", content: "first" }],
    });

    const { url, close } = await startServer(root);
    try {
      const resp = await fetch(`${url}/api/sessions/${id}/stream`);
      expect(resp.status).toBe(200);

      const readPromise = readSseLines(resp, 3000);
      await new Promise((r) => setTimeout(r, 300));
      appendFileSync(
        filepath,
        JSON.stringify({
          type: "message",
          id: "abcd1234",
          parentId: "00000001",
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "reply" }],
            timestamp: 0,
            model: "TestModel",
            usage: { input: 100, output: 50, totalTokens: 150, cost: { total: 0 } },
          },
        }) + "\n",
        "utf8",
      );

      const chunks = await readPromise;
      const events = parseSseEvents(chunks.join(""));
      const entryEvents = events.filter((e) => e.event === "entry");
      expect(entryEvents.length).toBeGreaterThan(0);

      const payload = JSON.parse(entryEvents[entryEvents.length - 1].data) as {
        entry?: { id?: string };
        stats?: { turns?: number; totalInputTokens?: number; latestContextTokens?: number };
      };
      expect(payload.entry?.id).toBe("abcd1234");
      expect(payload.stats).toBeDefined();
      expect(payload.stats?.turns).toBe(1);
      expect(payload.stats?.totalInputTokens).toBe(100);
      expect(payload.stats?.latestContextTokens).toBe(150);
    } finally {
      await close();
    }
  });
});
