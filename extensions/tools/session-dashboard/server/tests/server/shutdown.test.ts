// tests/server/shutdown.test.ts
// Exercise POST /api/shutdown: route semantics (method scoping, 200 body)
// and the wired-handler path (`setShutdownHandler` mirrors what `isMain`
// does — used here because the module-private wiring isn't reachable
// from outside).

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import {
    createHandler,
    setShutdownHandler,
    clearShutdownHandler,
} from "../../server";

let activeServer: Server | null = null;

async function startServer(sessionsDir: string): Promise<{ url: string; server: Server }> {
    const handler = createHandler({ sessionsDir, serveStatic: false });
    const server = createServer(handler);
    activeServer = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    return {
        url: `http://127.0.0.1:${addr.port}`,
        server,
    };
}

async function teardownServer(): Promise<void> {
    clearShutdownHandler();
    if (!activeServer) return;
    const s = activeServer;
    activeServer = null;
    await new Promise<void>((resolve) => {
        s.closeAllConnections?.();
        s.close(() => resolve());
    });
}

afterEach(async () => {
    await teardownServer();
});

describe("POST /api/shutdown", () => {
    it("returns 200 and { ok: true } when no handler is wired", async () => {
        const dir = mkdtempSync(join(tmpdir(), "shutdown-noop-"));
        try {
            const { url } = await startServer(dir);
            const res = await fetch(`${url}/api/shutdown`, { method: "POST" });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual({ ok: true });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("rejects non-POST methods (route is method-scoped)", async () => {
        const dir = mkdtempSync(join(tmpdir(), "shutdown-method-"));
        try {
            const { url } = await startServer(dir);
            // GET falls through to the catch-all 404.
            const getRes = await fetch(`${url}/api/shutdown`);
            expect(getRes.status).toBe(404);
            // PUT is also not matched.
            const putRes = await fetch(`${url}/api/shutdown`, { method: "PUT" });
            expect(putRes.status).toBe(404);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("invokes the wired handler when one is installed", async () => {
        const dir = mkdtempSync(join(tmpdir(), "shutdown-wired-"));
        try {
            const { url, server } = await startServer(dir);

            // Track invocation.
            let invoked = 0;
            setShutdownHandler(() => {
                invoked++;
                // Same pattern as the real `isMain` wiring: close +
                // force-close keep-alive sockets so the port is freed
                // immediately. The race against the 200 response is
                // expected — the client treats the network error as
                // success.
                server.closeAllConnections?.();
                server.close(() => {
                    /* swallow */
                });
            });

            // The handler fires synchronously AFTER `sendJson` queues
            // the 200 response. The socket close races the response
            // write; either the response arrives or it doesn't. Both
            // are valid outcomes — we just need to confirm the handler
            // was invoked.
            try {
                await fetch(`${url}/api/shutdown`, { method: "POST" });
            } catch {
                /* socket closed before response — expected */
            }
            expect(invoked).toBe(1);

            // After the handler runs, the server is closing. Give the
            // event loop a beat, then confirm the listener is no longer
            // accepting connections.
            await new Promise((r) => setTimeout(r, 50));
            await expect(fetch(`${url}/api/health`)).rejects.toThrow();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("clearShutdownHandler prevents invocation", async () => {
        const dir = mkdtempSync(join(tmpdir(), "shutdown-clear-"));
        try {
            const { url } = await startServer(dir);

            let invoked = 0;
            setShutdownHandler(() => {
                invoked++;
            });
            clearShutdownHandler();

            const res = await fetch(`${url}/api/shutdown`, { method: "POST" });
            expect(res.status).toBe(200);
            expect(invoked).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
