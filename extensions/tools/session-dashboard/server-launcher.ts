/**
 * Child-process launcher for the session-dashboard backend.
 *
 * The session-dashboard app runs `tsx server/server.ts` from the
 * project root (the server file moved into the `server/` workspace
 * member). This module spawns that process, waits until it is ready
 * (health endpoint responds or the listening line appears on stdout),
 * and exposes a graceful stop helper. Pure Node — no Pi dependency.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

export interface StartedServer {
    child: ChildProcess;
    url: string;
    port: number;
}

const HEALTH_TIMEOUT_MS = 5000;
const HEALTH_POLL_MS = 200;
const HEALTH_CONFIRM_MS = 1000;
const HEALTH_CONFIRM_POLL_MS = 50;
const STOP_TIMEOUT_MS = 3000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Absolute path to the `tsx` binary inside the session-dashboard project's
 * `node_modules`. Uses the `.cmd` shim on Windows.
 */
export function tsxBinPath(projectRoot: string): string {
    return resolvePath(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
}

/**
 * Spawn the session-dashboard backend (`tsx server/server.ts`) as a child
 * of this process and wait until it is ready to serve.
 *
 * Returns the child handle, the bound port, and the dashboard URL.
 * Throws on missing `tsx`, missing `dist/`, port already in use
 * (`EADDRINUSE` seen on the child's stderr), early child exit, or timeout.
 *
 * Note on the `distDir` check: `dist/` here is the dashboard SPA's Vite
 * production bundle at `server/dist/` (the workspace member's Vite
 * output), NOT a compiled copy of this extension (the extension itself
 * is no longer compiled — Pi loads the `.ts` sources directly). The
 * check stays because the backend serves `dist/` in production
 * (`NODE_ENV=production`), and `ensure-built` recreates it on first run
 * when missing.
 */
export async function startServer(options: { cwd: string; port: number; distDir: string }): Promise<StartedServer> {
    const { cwd, port, distDir } = options;

    const tsxBin = tsxBinPath(cwd);
    if (!existsSync(tsxBin)) {
        throw new Error(
            `tsx binary not found at ${tsxBin}. Run "npm install" in the session-dashboard project, then try again.`,
        );
    }
    if (!existsSync(distDir)) {
        throw new Error(
            `Frontend build missing at ${distDir}. Run "npm run build" in the session-dashboard project, then try again.`,
        );
    }

    const url = `http://127.0.0.1:${port}`;

    const child = spawn(tsxBin, ["server/server.ts"], {
        cwd,
        env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    // Consume stdout/stderr so the pipes never backpressure the child, and
    // so we can detect the readiness line / EADDRINUSE.
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
    });

    const listeningLine = `session-dashboard backend listening on http://127.0.0.1:${port}`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    try {
        while (Date.now() < deadline) {
            if (child.exitCode !== null) {
                const detail = stderr.trim() ? `\n${stderr.trim()}` : "";
                if (stderr.includes("EADDRINUSE")) {
                    throw new Error(
                        `Port ${port} is already in use (EADDRINUSE). Stop the conflicting process or set SESSION_DASHBOARD_PORT to a free port, then try again.${detail}`,
                    );
                }
                throw new Error(
                    `session-dashboard server exited before becoming ready (code=${child.exitCode}).${detail}`,
                );
            }
            if (stdout.includes(listeningLine)) {
                return { child, url, port };
            }
            try {
                const res = await fetch(`${url}/api/health`);
                if (res.ok) {
                    // A health 200 can be answered by an orphaned server on
                    // the same port (the session-dashboard server outlives
                    // the Pi session). Before trusting it, confirm it is OUR
                    // child: watch for the authoritative listening line, or
                    // for a bind failure (EADDRINUSE) to surface. Measured
                    // crash latency is ~150ms; HEALTH_CONFIRM_MS gives a
                    // comfortable margin for the settle window.
                    const settleAt = Date.now() + HEALTH_CONFIRM_MS;
                    let crashed = false;
                    while (Date.now() < settleAt && !crashed) {
                        if (child.exitCode !== null) {
                            crashed = true; // loop head handles the exit below
                            break;
                        }
                        if (stdout.includes(listeningLine)) {
                            return { child, url, port };
                        }
                        await sleep(HEALTH_CONFIRM_POLL_MS);
                    }
                    if (!crashed && child.exitCode === null && !stderr.includes("EADDRINUSE")) {
                        // Survived the settle window — the port is ours.
                        return { child, url, port };
                    }
                    // Fall through: the loop head observes the child's exit
                    // and throws the EADDRINUSE error.
                }
            } catch {
                // Not ready yet — keep polling.
            }
            await sleep(HEALTH_POLL_MS);
        }
        throw new Error(
            `Timed out waiting for session-dashboard server on ${url}.${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
        );
    } catch (err) {
        // Never leave an orphaned child behind when we bail out.
        if (child.exitCode === null) {
            child.kill("SIGKILL");
        }
        throw err;
    }
}

/**
 * Stop a spawned session-dashboard server. Sends SIGTERM and waits for the
 * process to exit; escalates to SIGKILL after `STOP_TIMEOUT_MS`.
 */
export function stopServer(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        const killTimer = setTimeout(() => {
            child.kill("SIGKILL");
        }, STOP_TIMEOUT_MS);
        child.once("exit", () => {
            clearTimeout(killTimer);
            resolve();
        });
        child.kill("SIGTERM");
    });
}