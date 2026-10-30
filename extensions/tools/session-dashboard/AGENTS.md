# session-dashboard

## Purpose

session-dashboard is a Pi extension that opens a local web viewer for Pi
agent sessions. The extension lives at the project root and ships with a
self-contained web app under `server/`. It reads JSONL files from
`~/.pi/agent/sessions/`, walks each session's active branch (the chain
from the leaf back to the root, with compactions respected), and renders
it as a chat-style UI in the browser.

The web app can be developed and run standalone (`npm run dev` from
`server/`). When loaded as a Pi extension, `/session-dashboard` builds
the SPA if needed, spawns the server, and opens the dashboard.

## Architecture

- **Extension (root)**: three `.ts` files loaded directly by Pi's jiti
  runtime — `index.ts`, `server-launcher.ts`, `ensure-built.ts`. No
  compile step, no `dist/`, no own `node_modules/`.
- **Backend (`server/server.ts`)**: a single-file Node HTTP server, run
  with `tsx`. Reads JSONL files from disk, walks the active branch,
  exposes REST endpoints and a Server-Sent Events stream, and serves the
  built SPA in production. Routes:
  - `GET /api/sessions` — list sessions.
  - `GET /api/sessions/:id` — `{header, branch, totalEntries}` for one session.
  - `GET /api/sessions/:id/stream?from=N` — SSE of new entries after byte offset `N`.
- **Frontend (`server/src/`)**: a React + Vite single-page app. Hash
  routing (`#/`, `#/session/:id`). The Vite dev server proxies `/api` to
  the backend on port 53510.
- **Wire format**: the session-detail endpoint returns
  `{header, branch, totalEntries}`. `branch: SessionEntry[]` is
  **leaf-first** — the newest entry is at index 0, the oldest is at the
  end. This is the server contract; do not change it without
  coordinating with the frontend.
- **Display convention**: the client REVERSES `branch` for display so
  the newest message is at the bottom of the viewport (standard chat).
  New entries received via SSE are PREPENDED to `branch` state (so they
  appear at the visual bottom). Auto-scroll-to-bottom still lands on the
  newest message.

## Conventions — extension (root)

- The extension is ESM TypeScript loaded directly from source by Pi's
  host runtime (jiti). There is no compile step; the nearest
  `package.json` is the project root's, which declares `"type": "module"`.
- Relative imports are extensionless: `import { ensureBuilt } from
  "./ensure-built"` (this only resolves under tsx/jiti-style loaders,
  never under plain Node ESM — keep it that way).
- Path resolution uses `import.meta.dirname` (Node 20.11+). After the
  promotion, `EXTENSION_DIR = PROJECT_ROOT = import.meta.dirname`.
- `@mariozechner/pi-coding-agent` is imported as `import type` only and
  is erased at runtime; the host resolves it via its own
  aliases/virtualModules. A standalone `tsc` run cannot resolve it
  without the host's types — that is expected and matches the other
  extensions.

## How the extension works

- `index.ts` registers `/session-dashboard`. On invocation it ensures the
  SPA `server/dist/` is fresh (`ensure-built.ts`), spawns the backend as
  a child process (`server-launcher.ts`), and opens the browser.
- The extension spawns `tsx server/server.ts` from the project root as a
  child process. It does not import the server file directly.
- `PORT` and `NODE_ENV=production` are passed via env. The server's
  existing `createHandler({ serveStatic: true })` branch serves
  `server/dist/` automatically.
- The `dist/` checked by `ensure-built.ts` / `server-launcher.ts` is the
  Vite SPA bundle at `server/dist/`, NOT a compiled copy of the
  extension (the extension itself is never compiled).
- Build delegation: `npm run build` from root runs
  `npm --workspace server run build`, which `tsc -b`s and produces the
  Vite bundle in `server/dist/`.

## Conventions — server (`server/`)

See `server/AGENTS.md` for server-side conventions (active-branch walk,
display order, filter-aware dispatcher, etc.).

## Lifecycle

- The server outlives the Pi session. `session_shutdown` is intentionally
  NOT wired.
- `/session-dashboard --stop` terminates the child via SIGTERM (then
  SIGKILL after 3s).

## Run commands

Run from the project root (these delegate to the `server` workspace):

- `npm run dev` — both the backend server (53510) and the Vite dev server
  (53509) concurrently.
- `npm run dev:server` — backend only.
- `npm run dev:client` — Vite only.
- `npm run build` — `tsc -b && vite build` → `server/dist/`.
- `npm run preview` — preview the built bundle.
- `npm test` — Vitest, all tests.
- `npm test:watch` — Vitest watch mode.
- `npm run typecheck` — `tsc -b` over server tsconfigs.

To target the server workspace directly: `npm --workspace server run …`.
