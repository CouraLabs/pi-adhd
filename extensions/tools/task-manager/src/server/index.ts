import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, resolve as resolvePath, dirname } from "node:path";
import {
    handleHealth,
    handleListWorkspaces,
    handleGetWorkspace,
    handleGetTask,
    handleCreateTask,
    handleUpdateTask,
    handleMoveTask,
    handleShutdown,
    type RouteResponse,
} from "./routes.ts";

/**
 * Absolute path to `src/server/public/` — the frontend assets served for
 * any non-`/api/*` request. Resolved relative to this module's location so
 * it works regardless of the process's cwd.
 */
const PUBLIC_DIR = resolvePath(import.meta.dirname, "public");

/**
 * Extension → Content-Type map for static assets. Anything not listed
 * defaults to `application/octet-stream`.
 */
const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
};

function contentTypeFor(filePath: string): string {
    return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve a URL pathname to an absolute file path under `PUBLIC_DIR`, or
 * return an error code if the request would escape the public directory
 * (path traversal). Returns `{ status: 400 }` on traversal, `{ status: 404 }`
 * when the path is `null` (e.g. impossible URLs).
 */
export function resolveStaticPath(urlPath: string): { status: number; filePath?: string } {
    // Strip query string and fragment if any (Node's `req.url` can include them).
    const cleanPath = urlPath.split("?", 1)[0].split("#", 1)[0];

    // Decode percent-encoded chars so `/%2e%2e/foo` is normalized before
    // resolving. Reject NUL bytes outright — they have no legitimate use in
    // a URL and can't appear on the filesystem.
    let decoded: string;
    try {
        decoded = decodeURIComponent(cleanPath);
    } catch {
        return { status: 400 };
    }
    if (decoded.includes("\0")) {
        return { status: 400 };
    }

    // Treat "/" as the index page.
    const relative = decoded === "/" ? "/index.html" : decoded;

    // Pin to the public dir and verify the resolved path stays inside it.
    const candidate = resolvePath(PUBLIC_DIR, "." + relative);
    const rootWithSep = PUBLIC_DIR.endsWith("/") || PUBLIC_DIR.endsWith("\\")
        ? PUBLIC_DIR
        : PUBLIC_DIR + "/";
    const isWin = process.platform === "win32";
    const root = isWin ? rootWithSep.toLowerCase() : rootWithSep;
    const target = isWin ? candidate.toLowerCase() : candidate;
    const rootBare = isWin ? PUBLIC_DIR.toLowerCase() : PUBLIC_DIR;
    if (!target.startsWith(root) && target !== rootBare) {
        return { status: 400 };
    }

    return { status: 200, filePath: candidate };
}

/**
 * Serve a static file from `PUBLIC_DIR` for any non-`/api/*` request.
 * Handles its own `res.writeHead` / `res.end` because static responses need
 * to carry binary bodies that don't fit the JSON `RouteResponse` shape.
 *
 * - 200: file read OK
 * - 400: path-traversal attempt (`resolveStaticPath` rejected)
 * - 404: file does not exist under `PUBLIC_DIR`
 * - 500: any other filesystem error
 */
export async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const resolved = resolveStaticPath(url);
    if (resolved.status !== 200 || resolved.filePath === undefined) {
        sendError(res, resolved.status as 400 | 404, "Not found");
        return;
    }
    try {
        const body = await readFile(resolved.filePath);
        res.writeHead(200, {
            "Content-Type": contentTypeFor(resolved.filePath),
            "Content-Length": body.length,
        });
        res.end(body);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
            sendError(res, 404, "Not found");
            return;
        }
        // eslint-disable-next-line no-console
        console.error("[task-dashboard] static read error:", err);
        sendError(res, 500, "Internal server error");
    }
}

/**
 * Default port used when `TASK_DASHBOARD_PORT` is unset.
 * Per spec §2.1.
 */
const DEFAULT_PORT = 7254;

/**
 * Route pattern for `GET /api/workspaces/:id`. Capture group 1 is the
 * (still URL-encoded) workspace id. Single-segment only.
 */
const RE_WORKSPACE = /^\/api\/workspaces\/(.+)$/;

/**
 * Route pattern for `GET /api/tasks/:workspace/:lane/:filename`. All three
 * params are single-segment, URL-encoded. Also used for `PUT` (update).
 */
const RE_TASK = /^\/api\/tasks\/([^/]+)\/([^/]+)\/([^/]+)$/;

/**
 * Route pattern for `POST /api/tasks/:workspace/:lane/:filename/move`.
 * The literal "move" suffix distinguishes it from the 3-segment task routes
 * (RE_TASK above requires exactly 3 segments, so the 4-segment move URL
 * never overlaps — but the match is kept explicit for clarity).
 */
const RE_MOVE = /^\/api\/tasks\/([^/]+)\/([^/]+)\/([^/]+)\/move$/;

/** Maximum accepted JSON request body size (1MB). */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Collect and parse the JSON request body from an `IncomingMessage`.
 * Returns `{ ok: true, body }` on success, or `{ ok: false, error }` when
 * the body is too large or fails to parse.
 */
async function readJsonBody(req: IncomingMessage): Promise<
    | { ok: true; body: unknown }
    | { ok: false; error: string }
> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > MAX_BODY_BYTES) {
            return { ok: false, error: "Request body too large" };
        }
        chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    try {
        return { ok: true, body: JSON.parse(text) };
    } catch {
        return { ok: false, error: "Invalid JSON body" };
    }
}

/**
 * Module-scoped callback that the `/api/shutdown` route invokes to
 * actually stop the HTTP server. Wired in `startDashboardServer()` so the
 * shutdown route has a way to reach the listening socket it lives on.
 * Set to a no-op by default so that unit tests of `dispatch()` (which
 * don't start a real server) don't NPE.
 */
let shutdownHandler: (() => void) | null = null;

/**
 * Send a `RouteResponse` as JSON on the wire.
 */
function sendJson(res: ServerResponse, routeRes: RouteResponse): void {
    const json = JSON.stringify(routeRes.body);
    res.writeHead(routeRes.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(json, "utf8"),
    });
    res.end(json);
}

/**
 * Send a plain `{ error: string }` JSON response.
 */
function sendError(res: ServerResponse, status: 400 | 404 | 500, error: string): void {
    sendJson(res, { status, body: { error } });
}

/**
 * Route an `IncomingMessage` URL to the appropriate handler. Returns the
 * matched response. Any unhandled path under `/api/*` returns 404.
 *
 * Exported for tests and so future steps (e.g. static file serving) can
 * layer on top of the same dispatch.
 */
export async function dispatch(req: IncomingMessage, body?: unknown): Promise<RouteResponse> {
    const url = req.url ?? "/";

    // POST /api/shutdown — only POST is accepted. Used by the dashboard's
    // Kill button to stop the HTTP server from the browser.
    if (url === "/api/shutdown" && req.method === "POST") {
        return handleShutdown(() => {
            if (shutdownHandler) {
                shutdownHandler();
            }
        });
    }

    if (url === "/api/health") return handleHealth();
    if (url === "/api/workspaces") return handleListWorkspaces();

    // POST /api/tasks — create a task. Only POST is accepted.
    if (url === "/api/tasks" && req.method === "POST") {
        return handleCreateTask(body);
    }

    const wsMatch = url.match(RE_WORKSPACE);
    if (wsMatch) {
        const id = decodeURIComponent(wsMatch[1]);
        return handleGetWorkspace(id);
    }

    // POST /api/tasks/:workspace/:lane/:filename/move — move a task between
    // lanes. Checked before RE_TASK so the literal "move" suffix is never
    // captured as a task filename (the regexes don't overlap, but being
    // explicit is cheap). Only POST is accepted.
    const moveMatch = url.match(RE_MOVE);
    if (moveMatch && req.method === "POST") {
        const workspace = decodeURIComponent(moveMatch[1]);
        const lane = decodeURIComponent(moveMatch[2]);
        const filename = decodeURIComponent(moveMatch[3]);
        return handleMoveTask(workspace, lane, filename, body);
    }

    const taskMatch = url.match(RE_TASK);
    if (taskMatch) {
        const workspace = decodeURIComponent(taskMatch[1]);
        const lane = decodeURIComponent(taskMatch[2]);
        const filename = decodeURIComponent(taskMatch[3]);
        // PUT /api/tasks/:workspace/:lane/:filename — update. Only PUT is
        // accepted (HEAD falls through to the GET handler below).
        if (req.method === "PUT") {
            return handleUpdateTask(workspace, lane, filename, body);
        }
        return handleGetTask(workspace, lane, filename);
    }

    if (url.startsWith("/api/")) {
        return { status: 404, body: { error: "Not found" } };
    }

    // Non-`/api/*` requests are handled by `serveStatic` in the request
    // handler, BEFORE reaching `dispatch()`. Returning 404 here is a
    // defensive fallback.
    return { status: 404, body: { error: "Not found" } };
}

/**
 * Start the dashboard HTTP server bound to IPv4 loopback.
 *
 * Returns the listening URL, the bound port, and the `http.Server` handle.
 * Throws on `EADDRINUSE` with a user-facing message that mentions
 * `TASK_DASHBOARD_PORT`.
 */
export async function startDashboardServer(): Promise<{
    url: string;
    port: number;
    server: http.Server;
}> {
    const rawPort = process.env.TASK_DASHBOARD_PORT ?? String(DEFAULT_PORT);
    const port = parseInt(rawPort, 10);
    // Port 0 is allowed — it's the OS-assigned-ephemeral sentinel, useful
    // for tests. Negative / NaN / > 65535 are not user-meaningful.
    if (!Number.isFinite(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid TASK_DASHBOARD_PORT: ${rawPort}`);
    }

    const server = http.createServer(async (req, res) => {
        // Allow GET, HEAD (static + read APIs) and POST (shutdown + create
        // endpoints) and PUT (task update). Anything else is rejected.
        if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST" && req.method !== "PUT") {
            sendError(res, 404, "Not found");
            return;
        }

        const url = req.url ?? "/";

        // Non-`/api/*` requests are served as static files from PUBLIC_DIR.
        // Branching here (rather than going through `dispatch()`) keeps the
        // JSON `RouteResponse` shape free of binary-body concerns.
        if (!url.startsWith("/api/")) {
            await serveStatic(req, res);
            return;
        }

        // Defensive CORS header — server is loopback-only, but setting it
        // is cheap and avoids surprises when the frontend is opened from
        // a different origin (e.g. a vite preview). Pinned to `127.0.0.1`
        // because that's where the server actually binds (binding to
        // `localhost` could resolve to `::1` and route to a different
        // service squatting on the same port).
        res.setHeader("Access-Control-Allow-Origin", `http://127.0.0.1:${port}`);

        try {
            // Read the JSON body for write endpoints (POST create, PUT
            // update, and POST move) before dispatching.
            let body: unknown;
            const isCreate = req.method === "POST" && url === "/api/tasks";
            const isUpdate = req.method === "PUT" && url.startsWith("/api/tasks/");
            const isMove = req.method === "POST" && RE_MOVE.test(url);
            if (isCreate || isUpdate || isMove) {
                const json = await readJsonBody(req);
                if (!json.ok) {
                    sendError(res, 400, json.error);
                    return;
                }
                body = json.body;
            }

            const routeRes = await dispatch(req, body);
            sendJson(res, routeRes);
        } catch (err) {
            // Never leak stack traces; log to stderr for ops debugging.
            // eslint-disable-next-line no-console
            console.error("[task-dashboard] handler error:", err);
            sendError(res, 500, "Internal server error");
        }
    });

    await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (err: NodeJS.ErrnoException) => {
            server.removeListener("listening", onListening);
            rejectListen(err);
        };
        const onListening = () => {
            server.removeListener("error", onError);
            resolveListen();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
    }).catch((err: NodeJS.ErrnoException) => {
        // Wrap EADDRINUSE with a clear message that mentions the env var,
        // per spec §2.1 / §6.1. Other errors are rethrown as-is.
        if (err && err.code === "EADDRINUSE") {
            const wrapped = new Error(
                `Port ${port} is already in use. Set TASK_DASHBOARD_PORT to a free port and try again.`,
            ) as NodeJS.ErrnoException;
            wrapped.code = err.code;
            throw wrapped;
        }
        throw err;
    });

    const addr = server.address();
    const boundPort = typeof addr === "string" ? port : (addr as AddressInfo).port;
    // Pin the URL to `127.0.0.1` to match the bind address. `localhost` can
    // resolve to `::1` (IPv6 loopback) on systems where another service is
    // already squatting on the IPv6 side of the same port, which would
    // route the browser to that other service rather than ours.
    const url = `http://127.0.0.1:${boundPort}`;

    // Wire the shutdown route to actually close this server. We capture
    // `boundPort` here so the closure survives the function returning.
    const portForShutdown = boundPort;
    shutdownHandler = () => {
        // Close is async but we don't await — the HTTP layer will have
        // already sent the response by the time this fires. Errors are
        // logged but otherwise swallowed; the socket is going away.
        server.close((err) => {
            if (err) {
                // eslint-disable-next-line no-console
                console.error(`[task-dashboard] shutdown error on :${portForShutdown}:`, err);
            }
        });
        // Force-close any keep-alive sockets so the port is freed
        // immediately. `close()` alone waits for in-flight requests to
        // drain, which means `listen()` on the same port would race.
        server.closeAllConnections?.();
    };

    return { url, port: boundPort, server };
}

/**
 * Stop a running dashboard server. Used by Step 6 (`/couralabs:task-dashboard` command
 * shutdown). Resolves once the server has fully closed.
 */
export async function stopDashboardServer(server: http.Server): Promise<void> {
    await new Promise<void>((resolveClose, rejectClose) => {
        server.close(err => (err ? rejectClose(err) : resolveClose()));
    });
}

/**
 * Disconnect the module-scoped shutdown handler. Called by the extension
 * entry after a manual shutdown so a subsequent `/couralabs:task-dashboard` can
 * re-wire a new handler.
 */
export function clearShutdownHandler(): void {
    shutdownHandler = null;
}

// Re-export for testability / convenience.
export type { RouteResponse };
