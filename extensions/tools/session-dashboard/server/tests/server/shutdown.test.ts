// tests/server/shutdown.test.ts
// Exercise POST /api/shutdown: route semantics (method scoping, 200 body)
// and the wired-handler path (`setShutdownHandler` mirrors what `isMain`
// does — used here because the module-private wiring isn't reachable
// from outside).

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createServer, request as httpRequest, type Server } from "node:http";
import {
    createHandler,
    setShutdownHandler,
    clearShutdownHandler,
} from "../../server";

let activeServer: Server | null = null;

const JSON_HEADERS = { "content-type": "application/json" };

function rawRequest(
    url: string,
    opts: { method?: string; path: string; headers: Record<string, string> },
): Promise<{ status: number; body: string }> {
    const { port } = new URL(url);
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers: opts.headers },
            (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
            },
        );
        req.on("error", reject);
        req.end();
    });
}

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
            const res = await fetch(`${url}/api/shutdown`, { method: "POST", headers: JSON_HEADERS });
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
                await fetch(`${url}/api/shutdown`, { method: "POST", headers: JSON_HEADERS });
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

            const res = await fetch(`${url}/api/shutdown`, { method: "POST", headers: JSON_HEADERS });
            expect(res.status).toBe(200);
            expect(invoked).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("request origin checks", () => {
    async function withServer(fn: (url: string, port: number) => Promise<void>): Promise<void> {
        const dir = mkdtempSync(join(tmpdir(), "origin-"));
        try {
            const { url } = await startServer(dir);
            await fn(url, Number(new URL(url).port));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it("rejects shutdown without a JSON content-type and does not invoke the handler", async () => {
        await withServer(async (url) => {
            let invoked = 0;
            setShutdownHandler(() => {
                invoked++;
            });
            const none = await fetch(`${url}/api/shutdown`, { method: "POST" });
            expect(none.status).toBe(415);
            const text = await fetch(`${url}/api/shutdown`, {
                method: "POST",
                headers: { "content-type": "text/plain" },
            });
            expect(text.status).toBe(415);
            expect(invoked).toBe(0);
        });
    });

    it("accepts a JSON content-type with a charset parameter", async () => {
        await withServer(async (url) => {
            const res = await fetch(`${url}/api/shutdown`, {
                method: "POST",
                headers: { "content-type": "application/json; charset=utf-8" },
            });
            expect(res.status).toBe(200);
        });
    });

    it("rejects a foreign Origin on reads and on shutdown", async () => {
        await withServer(async (url) => {
            let invoked = 0;
            setShutdownHandler(() => {
                invoked++;
            });
            const read = await fetch(`${url}/api/sessions`, { headers: { origin: "https://evil.example" } });
            expect(read.status).toBe(403);
            expect(read.headers.get("access-control-allow-origin")).toBeNull();
            const kill = await fetch(`${url}/api/shutdown`, {
                method: "POST",
                headers: { ...JSON_HEADERS, origin: "https://evil.example" },
            });
            expect(kill.status).toBe(403);
            expect(invoked).toBe(0);
        });
    });

    it("rejects Origin: null", async () => {
        await withServer(async (url) => {
            const res = await fetch(`${url}/api/health`, { headers: { origin: "null" } });
            expect(res.status).toBe(403);
        });
    });

    it("rejects an Origin on another local port", async () => {
        await withServer(async (url, port) => {
            const res = await fetch(`${url}/api/health`, { headers: { origin: `http://127.0.0.1:${port + 1}` } });
            expect(res.status).toBe(403);
        });
    });

    it("rejects a Host that is not loopback on this port", async () => {
        await withServer(async (url, port) => {
            for (const host of ["evil.example", `evil.example:${port}`, `127.0.0.1:${port + 1}`, "127.0.0.1"]) {
                const res = await rawRequest(url, { path: "/api/health", headers: { host } });
                expect(res.status).toBe(403);
            }
        });
    });

    it("rejects a request with no Host header", async () => {
        await withServer(async (url) => {
            const { port } = new URL(url);
            const status = await new Promise<number>((resolve, reject) => {
                const sock = connect(Number(port), "127.0.0.1", () => {
                    sock.write("GET /api/health HTTP/1.0\r\n\r\n");
                });
                let data = "";
                sock.on("data", (c) => (data += c));
                sock.on("end", () => resolve(Number(data.split(" ")[1])));
                sock.on("error", reject);
            });
            expect(status).toBe(403);
        });
    });

    it("accepts same-origin requests with 127.0.0.1 and localhost hosts", async () => {
        await withServer(async (url, port) => {
            const plain = await fetch(`${url}/api/health`);
            expect(plain.status).toBe(200);
            const sameOrigin = await fetch(`${url}/api/health`, { headers: { origin: `http://127.0.0.1:${port}` } });
            expect(sameOrigin.status).toBe(200);
            const viaLocalhost = await rawRequest(url, {
                path: "/api/health",
                headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` },
            });
            expect(viaLocalhost.status).toBe(200);
            const upperCase = await rawRequest(url, { path: "/api/health", headers: { host: `LOCALHOST:${port}` } });
            expect(upperCase.status).toBe(200);
        });
    });

    it("sends no CORS headers and has no OPTIONS handler", async () => {
        await withServer(async (url, port) => {
            const res = await fetch(`${url}/api/health`);
            expect(res.headers.get("access-control-allow-origin")).toBeNull();
            const pre = await fetch(`${url}/api/shutdown`, {
                method: "OPTIONS",
                headers: { origin: `http://127.0.0.1:${port}`, "access-control-request-method": "POST" },
            });
            expect(pre.status).toBe(404);
            expect(pre.headers.get("access-control-allow-origin")).toBeNull();
        });
    });
});
