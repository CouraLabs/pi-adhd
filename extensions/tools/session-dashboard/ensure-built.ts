/**
 * Build-cache helpers for the session-dashboard extension.
 *
 * Pure Node code — no Pi dependency. Decides whether the session-dashboard
 * SPA (`dist/`) needs rebuilding before the dashboard server is spawned.
 *
 * The session-dashboard project's `dist/` is a Vite bundle (one
 * `index.html` plus `assets/index-*.{js,css}`), NOT a tsc mirror of
 * `src/`. The freshness check is therefore: is `dist/index.html` present,
 * and is its mtime ≥ the mtime of every file in `src/`? When yes, the
 * build is up to date. When no (missing or any source is newer), rebuild.
 */

import { exec } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * The extension folder. After the restructure the extension lives at the
 * project root, so `import.meta.dirname` IS the project root.
 * Pi's host runtime (jiti) loads the extension directly from `.ts`
 * source (Node 20.11+). No compiled `dist/` indirection.
 */
const EXTENSION_DIR = import.meta.dirname;

/**
 * The session-dashboard project root — same as `EXTENSION_DIR` after the
 * promotion.
 */
const PROJECT_ROOT = EXTENSION_DIR;

/**
 * The SPA's source and build directories. After the restructure both
 * live inside the `server/` workspace member.
 */
const SERVER_SRC_DIR = resolvePath(EXTENSION_DIR, "server", "src");
const SERVER_DIST_DIR = resolvePath(EXTENSION_DIR, "server", "dist");

/**
 * Recursively walk a directory and return a flat list of absolute file
 * paths. Missing/unreadable directories yield [].
 */
async function walkFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: import("node:fs").Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = resolvePath(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await walkFiles(full)));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

/**
 * True when `distDir/index.html` is missing, OR when any file under
 * `srcDir` has an mtime strictly newer than `distDir/index.html`.
 *
 * The mtime comparison is anchored on `distDir/index.html` (the Vite
 * entrypoint) — Vite rewrites the whole bundle atomically on each build,
 * so a single timestamp captures "is this build current?". We compare
 * against every source file under `srcDir`.
 */
export async function isBuildStale(srcDir: string, distDir: string): Promise<boolean> {
    const indexPath = resolvePath(distDir, "index.html");
    let indexStat: import("node:fs").Stats;
    try {
        indexStat = await stat(indexPath);
    } catch {
        return true; // index.html missing → never built → stale
    }
    const srcFiles = await walkFiles(srcDir);
    for (const srcFile of srcFiles) {
        let srcStat: import("node:fs").Stats;
        try {
            srcStat = await stat(srcFile);
        } catch {
            continue;
        }
        if (srcStat.mtimeMs > indexStat.mtimeMs) return true;
    }
    return false;
}

/**
 * Default build function: invokes `server`'s `npm run build` via the npm
 * workspace machinery, from the project root. Rejects on non-zero exit
 * (promisified `exec` semantics).
 */
async function runDefaultBuild(): Promise<void> {
    const { stdout, stderr } = await execAsync("npm --workspace server run build", {
        cwd: PROJECT_ROOT,
        maxBuffer: 4 * 1024 * 1024,
    });
    void stdout;
    void stderr;
}

/**
 * Single-flight promise so parallel calls share one build instead of
 * kicking off two `npm run build` invocations.
 *
 * Set eagerly, BEFORE awaiting `isBuildStale`, so two concurrent callers
 * both see a non-null `buildInFlight` and coalesce. The promise wraps the
 * full lifecycle: stale-check → run build → clear flag.
 */
let buildInFlight: Promise<void> | null = null;

/**
 * Rebuild the session-dashboard SPA when `dist/` is stale relative to
 * `src/`, then resolve. No-op when the build is up to date.
 *
 * @param buildFn optional build command (defaults to `npm run build` from
 * the session-dashboard root).
 */
export async function ensureBuilt(buildFn: () => Promise<void> = runDefaultBuild): Promise<void> {
    if (buildInFlight) return buildInFlight;

    buildInFlight = (async () => {
        try {
            const stale = await isBuildStale(SERVER_SRC_DIR, SERVER_DIST_DIR);
            if (!stale) return; // up to date, nothing to do
            await buildFn();
        } finally {
            buildInFlight = null;
        }
    })();

    return buildInFlight;
}
