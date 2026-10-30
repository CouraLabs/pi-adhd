/**
 * session-dashboard extension for Pi.
 *
 * Registers `/session-dashboard`. Spawns the session-dashboard backend
 * (`tsx server.ts`) as a child process and opens the dashboard in the
 * browser. The server outlives the Pi session — `/session-dashboard --stop`
 * terminates it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { ensureBuilt } from "./ensure-built";
import { startServer, stopServer } from "./server-launcher";

const execAsync = promisify(exec);

/**
 * Module-scoped handle for the spawned session-dashboard server. Set on
 * first `/session-dashboard` invocation, consulted on subsequent
 * invocations for idempotency, cleared by `/session-dashboard --stop` or
 * when the child exits unexpectedly. There is intentionally no
 * `session_shutdown` wiring — the server outlives the session.
 */
let serverHandle: { child: import("node:child_process").ChildProcess; url: string; port: number } | null = null;

/**
 * Path to the extension folder. After the restructure the extension
 * lives at the project root, so this is just `import.meta.dirname`.
 * Pi's host runtime (jiti) loads the extension directly from `.ts`
 * source (Node 20.11+). There is no compiled `dist/` indirection.
 */
const EXTENSION_ROOT = import.meta.dirname;

/**
 * Path to the session-dashboard project root. Same as `EXTENSION_ROOT`
 * after the promotion of `extension/` to root.
 */
const PROJECT_ROOT = EXTENSION_ROOT;

/**
 * Default port — matches session-dashboard's default. Override with
 * `SESSION_DASHBOARD_PORT`.
 */
const DEFAULT_PORT = 53510;

/**
 * Cross-platform helper for opening a URL in the OS default browser.
 * Mirrors the pattern used by the task-manager extension.
 *
 * Escapes hatch: `BROWSER=none` skips the spawn entirely. The URL is
 * still surfaced via `ctx.ui.notify` in the caller.
 */
function openBrowser(url: string): void {
    if (process.env.BROWSER === "none") return;
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execAsync(`${cmd} "${url}"`).catch(() => {
        // Swallow: the URL was already surfaced via ctx.ui.notify.
    });
}

function getPort(): number {
    return parseInt(process.env.SESSION_DASHBOARD_PORT ?? String(DEFAULT_PORT), 10);
}

function getUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
}

/**
 * Build the SPA via the server workspace's `npm run build`. After the
 * restructure the SPA lives in `server/`; we delegate to its script
 * through npm workspaces so callers don't need a separate `cd`. Rejects
 * on non-zero exit (promisified `exec` semantics).
 */
async function runBuild(): Promise<void> {
    const { stdout, stderr } = await execAsync("npm --workspace server run build", {
        cwd: PROJECT_ROOT,
        maxBuffer: 4 * 1024 * 1024,
    });
    void stdout;
    void stderr;
}

function runNpmInstall(): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn("npm", ["install"], { cwd: EXTENSION_ROOT, stdio: "inherit" });
        child.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`npm install failed with exit code ${code} (cwd: ${EXTENSION_ROOT})`));
        });
        child.on("error", reject);
    });
}

export default function (pi: ExtensionAPI) {
    markExtensionLoaded("session-dashboard");
    pi.registerCommand("couralabs:session-dashboard", {
        description:
            "Open the session dashboard in your browser (http://127.0.0.1:53510 by default; override with SESSION_DASHBOARD_PORT; BROWSER=none suppresses auto-open). The server outlives the session — use /session-dashboard --stop to terminate it.",
        async handler(args, ctx) {
            const trimmed = (args ?? "").trim();

            // ---- /session-dashboard --stop ----------------------------------
            if (trimmed === "--stop" || trimmed === "stop") {
                if (!serverHandle) {
                    ctx.ui.notify("No session-dashboard server is running.", "info");
                    return;
                }
                const { child, url } = serverHandle;
                serverHandle = null;
                try {
                    await stopServer(child);
                    ctx.ui.notify(`Stopped session-dashboard (${url})`, "info");
                } catch (err) {
                    ctx.ui.notify(
                        `Error stopping session-dashboard: ${err instanceof Error ? err.message : String(err)}`,
                        "error",
                    );
                }
                return;
            }

            // ---- /session-dashboard (default) -------------------------------
            const port = getPort();
            const url = getUrl(port);

            // Idempotency: reuse running server.
            if (serverHandle && serverHandle.child.exitCode === null && serverHandle.child.signalCode === null) {
                openBrowser(url);
                ctx.ui.notify(`Session dashboard: ${url}`, "info");
                return;
            }

            // Install dependencies on first use (no node_modules yet).
            if (!existsSync(resolvePath(EXTENSION_ROOT, "node_modules"))) {
                try {
                    ctx.ui.notify("session-dashboard: installing dependencies (npm install)…", "info");
                    await runNpmInstall();
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    ctx.ui.notify(`npm install failed: ${message}`, "error");
                    return;
                }
            }

            // Ensure SPA is built (dist/ exists and is fresh).
            try {
                await ensureBuilt(runBuild);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                ctx.ui.notify(`Build failed: ${message}`, "error");
                return;
            }

            // Spawn the server. The server file lives at `server/server.ts`
            // (the workspace member) and serves `server/dist/` in
            // production. `cwd` stays at the project root because that is
            // where `tsx` is resolved from `node_modules/.bin/`.
            let handle: { child: import("node:child_process").ChildProcess; url: string; port: number };
            try {
                handle = await startServer({
                    cwd: PROJECT_ROOT,
                    port,
                    distDir: resolvePath(PROJECT_ROOT, "server", "dist"),
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (/EADDRINUSE|already in use|listening/i.test(message)) {
                    ctx.ui.notify(
                        `Port ${port} is in use. Set SESSION_DASHBOARD_PORT to a free port, stop the conflicting process, then try again.`,
                        "error",
                    );
                } else if (/tsx.*not found|tsx' is not recognized/i.test(message)) {
                    ctx.ui.notify(
                        `Could not locate tsx. Run "npm install" in the session-dashboard project, then try again.`,
                        "error",
                    );
                } else {
                    ctx.ui.notify(message, "error");
                }
                return;
            }

            serverHandle = handle;

            // If the child exits unexpectedly, clear our handle so a future
            // invocation starts a fresh server.
            handle.child.on("exit", (code, signal) => {
                if (serverHandle && serverHandle.child === handle.child) {
                    serverHandle = null;
                }
                // Don't notify on intentional --stop (handle is already nulled).
                if (code !== 0 && code !== null && signal !== "SIGTERM") {
                    // Surface unexpected exits. Use console since ctx is not
                    // available outside the handler.
                    // eslint-disable-next-line no-console
                    console.error(`[session-dashboard] child exited unexpectedly: code=${code} signal=${signal}`);
                }
            });

            openBrowser(handle.url);
            ctx.ui.notify(`Session dashboard: ${handle.url}`, "info");
        },
    });
}