# session-dashboard

A Pi extension that registers the `/session-dashboard` slash command and
ships with a small web UI that lets you scroll, search, and tail your Pi
agent sessions in the browser. The web UI lives in `server/`; the
extension lives at the project root.

When you invoke `/session-dashboard`, the extension builds the SPA (if
needed), spawns the server, and opens the dashboard in your browser. The
server keeps running after the Pi session ends, so you can keep watching
live sessions. Use `/session-dashboard --stop` to shut it down.

## Layout

```
.
├── index.ts                 # extension entry — registers /session-dashboard
├── server-launcher.ts       # spawns the backend child process
├── ensure-built.ts          # SPA build-cache helper
├── package.json             # extension + npm workspace config
├── AGENTS.md                # project conventions
└── server/                  # standalone web app (the dashboard)
    ├── server.ts            # backend (`tsx server/server.ts`)
    ├── src/                 # React + Vite SPA
    ├── tests/               # vitest (server + client)
    ├── fixtures/            # sample session JSONLs for tests
    ├── package.json         # server's own deps + scripts
    ├── vite.config.ts
    ├── vitest.config.ts
    └── tsconfig.*.json
```

## Setup

The extension is plain ESM TypeScript loaded directly from source — there is
no build step, no `dist/`, and no `node_modules/` of its own. The server
subproject needs `npm install` once to provide `tsx`, the test runner, and
the SPA build toolchain. From the project root:

```bash
npm install                  # installs both workspaces (root + server)
npm run dev                  # backend on 53510, vite dev server on 53509
npm test                     # vitest, all tests (server + client)
npm run typecheck            # tsc -b over server tsconfigs
npm run build                # production SPA bundle → server/dist/
```

## Loading in Pi

Add the extension source path to `~/.pi/agent/settings.json` under
`extensions`:

```json
{
  "extensions": [
    "~/repo/pi-extensions/session-dashboard/index.ts"
  ]
}
```

Pi's host runtime (jiti) loads the `.ts` source directly, resolves the
extensionless relative imports (`./ensure-built`, `./server-launcher`), and
provides the `@mariozechner/pi-coding-agent` API via its own aliases. No
install or build step required for the extension itself.

## Usage

- `/session-dashboard` — build (if needed), start, and open the dashboard.
- `/session-dashboard --stop` (or `/session-dashboard stop`) — terminate the
  running server.

The browser is opened automatically. The server URL is also shown in a
notification.

## Environment variables

- `SESSION_DASHBOARD_PORT` — port to bind (default `53510`).
- `BROWSER=none` — suppress the auto-open browser step.

## Notes

- The server outlives the Pi session; there is intentionally no
  `session_shutdown` handler that stops it.
- The SPA must be built (`server/dist/index.html` present and fresh). It
  is built automatically on first run when missing or stale.

## Troubleshooting

- **Port in use** — the dashboard reports `EADDRINUSE`. Stop the conflicting
  process or set `SESSION_DASHBOARD_PORT` to a free port, then try again.
- **Missing `tsx`** — run `npm install` in the project root (the extension
  spawns `<root>/node_modules/.bin/tsx`).
- **Missing or stale `server/dist/`** — the extension rebuilds
  automatically; if it still fails, run `npm run build` from the project
  root.
