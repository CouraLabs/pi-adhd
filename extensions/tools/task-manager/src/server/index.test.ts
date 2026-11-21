import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { resolveStaticPath, serveStatic, startDashboardServer } from "./index.ts";

/* ---------- Unit-level helpers ---------- */

/** Build a minimal `IncomingMessage`-shaped object for resolveStaticPath tests. */
function asIncoming(url: string): http.IncomingMessage {
    return { url } as unknown as http.IncomingMessage;
}

/** Minimal `ServerResponse` recorder for unit-testing `serveStatic`. */
type Recorded = {
    res: http.ServerResponse;
    statusCode: () => number;
    headers: () => Record<string, string | number>;
    body: () => Buffer;
    ended: () => boolean;
};

function makeRes(): Recorded {
    const headers: Record<string, string | number> = {};
    let statusCode = 0;
    // Use a Uint8Array-backed view of Buffer so we can reassign freely
    // without tripping the ArrayBuffer vs ArrayBufferLike variance issue.
    let body: Uint8Array = Buffer.alloc(0);
    let ended = false;
    const res = {
        writeHead(status: number, hdrs?: Record<string, string | number>) {
            statusCode = status;
            if (hdrs) Object.assign(headers, hdrs);
            return res;
        },
        setHeader(name: string, value: string | number) {
            headers[name] = value;
        },
        end(chunk?: Buffer | Uint8Array | string) {
            ended = true;
            if (chunk) {
                body = typeof chunk === "string"
                    ? Buffer.from(chunk)
                    : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            }
            return res;
        },
    } as unknown as http.ServerResponse;
    return {
        res,
        statusCode: () => statusCode,
        headers: () => headers,
        // Return Buffer view to match the public Recorded type signature.
        body: () => Buffer.from(body),
        ended: () => ended,
    };
}

/* ---------- resolveStaticPath unit tests ---------- */

describe("resolveStaticPath", () => {
    it("maps '/' to <public>/index.html", () => {
        const r = resolveStaticPath("/");
        expect(r.status).toBe(200);
        expect(r.filePath).toMatch(/index\.html$/);
    });

    it("maps '/app.js' to the public asset directly", () => {
        const r = resolveStaticPath("/app.js");
        expect(r.status).toBe(200);
        expect(r.filePath).toMatch(/app\.js$/);
    });

    it("maps '/vendor/pico.min.css' to a nested public asset", () => {
        const r = resolveStaticPath("/vendor/pico.min.css");
        expect(r.status).toBe(200);
        expect(r.filePath).toMatch(/vendor[\\/]+pico\.min\.css$/);
    });

    it("rejects traversal via '/' as 400", () => {
        const r = resolveStaticPath("/../etc/passwd");
        expect(r.status).toBe(400);
        expect(r.filePath).toBeUndefined();
    });

    it("rejects traversal via percent-encoded segments as 400", () => {
        // /%2e%2e/%2e%2e/etc/passwd decodes to /../../etc/passwd
        const r = resolveStaticPath("/%2e%2e/%2e%2e/etc/passwd");
        expect(r.status).toBe(400);
        expect(r.filePath).toBeUndefined();
    });

    it("ignores query strings when resolving", () => {
        const r = resolveStaticPath("/styles.css?v=1");
        expect(r.status).toBe(200);
        expect(r.filePath).toMatch(/styles\.css$/);
    });

    it("strips query string before traversal check", () => {
        // Traversal attempt hidden behind a query string should still be blocked.
        const r = resolveStaticPath("/../../../etc/passwd?x=1");
        expect(r.status).toBe(400);
    });
});

/* ---------- serveStatic unit tests ---------- */

describe("serveStatic (unit)", () => {
    it("responds 404 when the path resolves but the file does not exist", async () => {
        const req = asIncoming("/nonexistent-file-xyz");
        const rec = makeRes();
        await serveStatic(req, rec.res);
        expect(rec.statusCode()).toBe(404);
        expect(rec.ended()).toBe(true);
        expect(rec.headers()["Content-Type"]).toBe("application/json; charset=utf-8");
        expect(JSON.parse(rec.body().toString("utf8"))).toEqual({ error: "Not found" });
    });

    it("responds 400 on a traversal attempt", async () => {
        const req = asIncoming("/../etc/passwd");
        const rec = makeRes();
        await serveStatic(req, rec.res);
        expect(rec.statusCode()).toBe(400);
        expect(JSON.parse(rec.body().toString("utf8"))).toEqual({ error: "Not found" });
    });
});

/* ---------- Integration: real HTTP server on ephemeral port ---------- */

function getRaw(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
    return new Promise((resolveFn, rejectFn) => {
        const r = http.get(url, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolveFn({
                status: res.statusCode || 0,
                headers: res.headers,
                body: Buffer.concat(chunks),
            }));
        });
        r.on("error", rejectFn);
    });
}

describe("static file serving (integration)", () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
        server = http.createServer(async (req, res) => {
            // Mirror the real request handler's branching for non-/api paths.
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not found" }));
                return;
            }
            const url = req.url ?? "/";
            if (url.startsWith("/api/")) {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Not found" }));
                return;
            }
            await serveStatic(req, res);
        });
        await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
        const addr = server.address() as AddressInfo;
        base = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>(r => server.close(() => r()));
    });

    it("GET / returns 200 with text/html", async () => {
        const r = await getRaw(`${base}/`);
        expect(r.status).toBe(200);
        expect(String(r.headers["content-type"])).toMatch(/text\/html/);
        expect(r.body.toString("utf8")).toContain("Task Dashboard");
    });

    it("GET /app.js returns 200 with JS Content-Type", async () => {
        const r = await getRaw(`${base}/app.js`);
        expect(r.status).toBe(200);
        expect(String(r.headers["content-type"])).toMatch(/application\/javascript/);
        expect(r.body.length).toBeGreaterThan(100);
        expect(r.body.toString("utf8")).toContain("checkHealth");
    });

    it("GET /styles.css returns 200 with css Content-Type", async () => {
        const r = await getRaw(`${base}/styles.css`);
        expect(r.status).toBe(200);
        expect(String(r.headers["content-type"])).toMatch(/text\/css/);
        expect(r.body.length).toBeGreaterThan(0);
    });

    it("GET /vendor/pico.min.css returns 200 with css Content-Type", async () => {
        const r = await getRaw(`${base}/vendor/pico.min.css`);
        expect(r.status).toBe(200);
        expect(String(r.headers["content-type"])).toMatch(/text\/css/);
        expect(r.body.length).toBeGreaterThan(1000);
    });

    it("GET /nonexistent returns 404", async () => {
        const r = await getRaw(`${base}/nonexistent`);
        expect(r.status).toBe(404);
    });

    it("GET /%2e%2e%2fetc%2fpasswd returns 400 (encoded traversal)", async () => {
        // The Node http client already normalizes '/' in the path before
        // sending, so we URL-encode the dots to keep the traversal-shaped
        // segment intact on the wire. The server's resolveStaticPath()
        // decodes them and rejects with 400.
        const r = await getRaw(`${base}/%2e%2e%2fetc%2fpasswd`);
        expect(r.status).toBe(400);
    });
});

/* ---------- /api/shutdown integration ---------- */

/** Fire a POST request and return the status + body. */
function postRaw(url: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolveFn, rejectFn) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                host: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: "POST",
                headers: { Accept: "application/json" },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                    resolveFn({ status: res.statusCode || 0, body: Buffer.concat(chunks) }),
                );
            },
        );
        req.on("error", rejectFn);
        req.end();
    });
}

describe("POST /api/shutdown (integration)", () => {
    it("returns 200 and stops the server", async () => {
        // Bind to ephemeral port (0) so we don't collide with anything.
        const prevPort = process.env.TASK_DASHBOARD_PORT;
        process.env.TASK_DASHBOARD_PORT = "0";

        let handle: Awaited<ReturnType<typeof startDashboardServer>>;
        try {
            handle = await startDashboardServer();
        } finally {
            // Restore env var regardless of startup outcome.
            if (prevPort === undefined) {
                delete process.env.TASK_DASHBOARD_PORT;
            } else {
                process.env.TASK_DASHBOARD_PORT = prevPort;
            }
        }

        const url = handle.url;
        const server = handle.server;

        try {
            // Sanity: server is listening.
            expect(server.listening).toBe(true);

            // Register the close listener BEFORE sending the POST — the
            // shutdown handler fires the close event synchronously after
            // the response is flushed, so if we await the POST first the
            // 'close' event may already have fired by the time we attach.
            const closedPromise = new Promise<void>((resolveClose, rejectClose) => {
                const timer = setTimeout(
                    () => rejectClose(new Error("server did not close within 2s")),
                    2000,
                );
                server.once("close", () => {
                    clearTimeout(timer);
                    resolveClose();
                });
            });

            // POST /api/shutdown.
            const res = await postRaw(`${url}/api/shutdown`);
            expect(res.status).toBe(200);
            const json = JSON.parse(res.body.toString("utf8"));
            expect(json).toEqual({ ok: true });

            await closedPromise;
            expect(server.listening).toBe(false);
        } finally {
            // Defensive: ensure we don't leak a server across tests even if
            // the assertions above threw.
            if (server.listening) {
                await new Promise<void>((r) => server.close(() => r()));
            }
        }
    });
});
