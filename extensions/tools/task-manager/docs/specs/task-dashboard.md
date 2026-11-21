# Task Dashboard — Spec

**Status:** Draft v3
**Scope:** v3 — web dashboard for the task-manager extension with create + edit support and drag-and-drop between lanes.
**Out of scope (v3):** real-time push, auth, multi-user, persistence beyond filesystem, task deletion from the UI.

---

## 1. Goal

Add a `/couralabs:task-dashboard` slash command to the `task-manager` extension that opens a local web dashboard in the user's browser. The dashboard displays tasks from **all projects** in `~/.pi/tasks/` as a Kanban-style board with horizontal lanes per status folder. v1 was read-only; v2 adds **creating** and **editing** tasks from the UI.

## 2. User-facing behavior

### 2.1 Invoking the dashboard

The user runs `/couralabs:task-dashboard` inside a pi session. The extension:

1. Starts a local HTTP server (if not already running) on `http://localhost:7254` (or `TASK_DASHBOARD_PORT` if set).
2. Opens the OS-default browser to that URL.
3. Notifies the user via `ctx.ui.notify` with the URL.

The command is **idempotent**: invoking it again reuses the running server and just reopens the tab.

The dashboard **pre-selects the workspace matching pi's current working directory**. If no such workspace directory exists under `~/.pi/tasks/`, the dashboard opens with **All projects** selected instead. (A workspace directory that exists but has zero tasks is still pre-selected, with an empty board.)

The server stays alive for the lifetime of the pi session by default. There is no auto-shutdown logic in v1 — simplicity over correctness. If the server is left running after pi quits, the user (or the next pi session) will hit "Port 7254 in use" on the next invocation and get a clear error. The dashboard exposes a **Kill** button (see §2.2) that lets the user stop the server from the browser.

### 2.2 Dashboard layout

```
┌────────────────────────────────────────────────────────────────┐
│  Project: [All projects ▼]      [New Task] [Refresh] [Kill]    │
├────────────────────────────────────────────────────────────────┤
│  ┌─Backlog──┐ ┌─Active───┐ ┌─user-qa──┐ ┌─Closed──┐           │
│  │ Card     │ │ Card     │ │ Card     │ │ Card     │           │
│  │ Card     │ │ Card     │ │ Card     │ │ Card     │           │
│  │ Card     │ │          │ │          │ │          │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

- **Project dropdown** at the top-left. First option is "All projects" (see §2.4). Below it, every workspace directory is listed (see §2.5). (On initial load — opened via `/couralabs:task-dashboard` — the dropdown is pre-selected to the workspace matching pi's cwd if such a directory exists; see §2.1.)
- **New Task button** to the left of Refresh. Opens the create-task modal (§2.9). Disabled when no workspaces exist (a task needs a workspace to live in).
- **Refresh button** at the top-right. Re-fetches lanes and tasks from the server. Keyboard shortcut: `r` (when no modal is open).
- **Kill button** to the right of Refresh. Posts `POST /api/shutdown` to stop the server, then replaces the page with a "Dashboard stopped" message and attempts `window.close()`. No confirmation prompt — the dashboard is trivial to restart with `/couralabs:task-dashboard`. See §4.9.
- **Lanes** are horizontal columns, one per status folder, scrollable vertically if many tasks.
- **Task cards** inside each lane show: title, priority badge, created date, tags. Cards are clickable — clicking opens the task in the edit modal (§2.9).
- **Cards are draggable** (§2.8). Dragging a card onto another lane moves the task to that status folder. Drops are only accepted onto lanes that already exist for the card's workspace — dragging to an unknown status shows a visible rejection and performs no move.

### 2.3 Card content (per card)

- **Title** (large)
- **Priority** — colored badge: `critical` (red), `high` (orange), `medium` (yellow), `low` (gray)
- **Created date** — `YYYY-MM-DD`, muted
- **Tags** — small pills, one per tag

When the dropdown is set to **"All projects"**, each card additionally shows a small **workspace badge** in the corner so the user can tell projects apart.

### 2.4 "All projects" mode

When the user selects "All projects":

- **Lanes are unioned**: if project A has lanes `[Backlog, Active, Done]` and project B has `[Backlog, Active, user-qa]`, the dashboard shows `[Backlog, Active, Done, user-qa]`. A lane is shown if it exists in **any** selected workspace.
- **Tasks within each lane are interleaved**, sorted alphabetically by title (case-insensitive). Each card shows its workspace badge so cards from different projects are visually distinguishable.
- If only one workspace exists on disk, the "All projects" view and the per-workspace view show the same data, but the dropdown still offers "All projects" as an option for consistency.

### 2.5 Workspaces

A **workspace** is any immediate subdirectory of `~/.pi/tasks/`. Every such directory is listed in the dropdown — even one with zero tasks, even one whose only tasks are in `Closed`. A workspace directory with no lane subdirectories is still listed; it shows `taskCount: 0` and the board renders no columns for it (see §2.6).

`taskCount` (shown next to each workspace in the dropdown and used for the "All projects" total) counts `.md` files across all lane subdirectories **except `Closed`** — i.e. open work only. A workspace whose tasks are all in `Closed` shows `taskCount: 0` even though it has tasks on disk.

Non-directory entries at the root of `~/.pi/tasks/` (e.g. stray files, dotfiles) are not listed as workspaces.

The "All projects" option is always shown, regardless of whether any workspaces exist.

### 2.6 Empty lanes

A lane is **a status folder under `~/.pi/tasks/<workspace>/`**. Every such folder is rendered as a column on the board, even when it has zero tasks — empty columns show the lane name, a `(0)` count, and no cards. Drag-and-drop onto an empty lane is allowed (it creates the move just like a drop onto a non-empty lane). No default lanes are invented: a workspace with zero folders shows no columns, and "All projects" with zero folders shows no columns.

### 2.8 Drag-and-drop between lanes

Cards are draggable across lanes. When the user drops a card onto a **lane that exists for the card's own workspace**, the task's file is moved to that lane folder (`POST /api/tasks/:workspace/:lane/:filename/move`, §4.8) and the board re-renders.

Strict lane validation:

- **Per-workspace view**: the target lane must be a real status folder in the workspace. The server validates against actual lane directories.
- **"All projects" view**: a drop is only accepted if the card's workspace itself has the target lane. Lanes that exist in *other* workspaces but not the card's own are rejected — the card never silently jumps workspaces.
- **Unknown lanes**: if the target lane does not exist, the server returns `404 { error: "Lane not found" }`; the frontend does **not** move the card and shows the drop as rejected (visual error state on the lane, error message, card stays put). Drops with no valid target do nothing.

Drag state is cleaned up on drop; the board re-renders after a successful move. Keyboard accessibility is out of scope.

### 2.9 Task modal (view / edit / create)

One modal is reused for three modes. Clicking a task card opens it in **view mode** showing the task rendered as Markdown; the **Edit** button turns the description into editable fields; the **New Task** button opens it in **create mode**.

**View mode** (opened by clicking a card):
- Title (large), meta line (priority badge, created date, `workspace / lane` breadcrumb, tags, task id chip), and the task body rendered as Markdown (via `marked` + `DOMPurify`, server-side).
- Footer: **Close** and **Edit** buttons.
- The X button, Escape, or clicking outside closes the modal.

**Edit mode** (opened via the Edit button):
- Title, Priority, Tags, and Notes (raw Markdown textarea) are pre-filled from the task.
- The meta line shows the created date, `workspace / lane` breadcrumb, and the task id chip (read-only).
- **Save** is at the bottom (+ Cancel). Save does a `PUT` (§4.6), re-fetches the task, and returns to **view mode** so the user sees the updated rendered Markdown.
- **Cancel** returns to view mode (discarding changes).

**Task id chip** (shown in both view and edit meta lines):
- Renders the task's UUID as a small monospaced, muted button.
- Clicking copies the id to the clipboard and flashes a "Copied!" confirmation for ~900ms.
- Falls back silently to plain selectable text when the Clipboard API is unavailable (e.g. insecure context).
- The id comes from `frontmatter.id` in the `GET` payload (§4.4) and is preserved across edits and moves.

**Create mode** (opened via New Task):
- Meta line shows the created date (today).
- The Notes textarea is pre-populated with the header style — `# Title` (H1 placeholder) followed by `## Notes` — so the task starts with the standard Markdown header.
- Workspace and Lane selects are shown (create-only). Workspace defaults to the currently-selected workspace (or the first one); Lane defaults to `Backlog`.
- On save, if the Notes body's first line is still the literal `# Title` placeholder, it is replaced with `# <actual title>`.
- Save → `POST /api/tasks` (§4.5). After a successful create, the modal closes and the workspace dropdown + lanes are refreshed (a create may have populated a previously-empty workspace).

Modal closes via: clicking outside the modal, clicking the X button, pressing `Escape`, or (view mode) the Close button. Only one modal open at a time. Errors (e.g. failed save) are shown inside the modal and the modal stays open.

## 3. Architecture

### 3.1 High-level

```
┌──────────────┐    /couralabs:task-dashboard    ┌──────────────────┐
│  pi session  │ ───────────────────► │  Extension (TS)  │
│              │                       │  - lazy server   │
│              │                       │  - opens browser │
└──────────────┘                       └────────┬─────────┘
                                                 │
                                                 │ HTTP
                                                 ▼
                                      ┌──────────────────┐
                                      │  Browser tab     │
                                      │  - HTML + Pico   │
                                      │  - vanilla JS    │
                                      └────────┬─────────┘
                                               │ fetch /api/*
                                               ▼
                                      ┌──────────────────┐
                                      │  Node HTTP srv   │
                                      │  (node:http)     │
                                      │  reads files in  │
                                      │  ~/.pi/tasks/    │
                                      └──────────────────┘
```

### 3.2 File layout

```
task-manager/
├── index.ts                       # Extension entry, registers /couralabs:task-dashboard
├── package.json                   # + "open" dep
├── tsconfig.json
├── docs/
│   └── specs/
│       └── task-dashboard.md      # This file
└── src/
    ├── tasks/                     # Shared task-loading lib (extracted from index.ts)
    │   ├── index.ts               # Public API: listWorkspaces, listLanes, listTasks, getTask
    │   ├── frontmatter.ts         # parseFrontmatter, parseBody
    │   └── paths.ts               # TASKS_ROOT, getWorkspaceName
    ├── server/                    # HTTP server
    │   ├── index.ts               # start/stop server, port management
    │   ├── routes.ts              # Route handlers (workspaces, lanes, tasks)
    │   ├── markdown.ts            # marked + DOMPurify wrapper
    │   └── static.ts              # Serves files from src/server/public/
    └── server/public/             # Static frontend
        ├── index.html             # Pico.css via local file, dashboard markup
        ├── app.js                 # Vanilla JS: fetch API, render lanes, modal logic
        └── styles.css             # Small overrides on top of Pico
```

`src/server/public/` is served directly by the Node HTTP server. No build step. Frontend changes are picked up on browser refresh.

### 3.3 Why no build step

- The dashboard is a small UI. Vanilla JS + Pico.css is sufficient.
- Avoids the `npm install` → `npm run build` → reload loop for a tool the user opens occasionally.
- Vite is available in `node_modules` (transitive) but **not** declared in `package.json`. Adding it as a build tool is out of scope for v1.

## 4. API design

All endpoints return JSON. Errors return `{ "error": string }` with appropriate HTTP status. CORS is disabled (server is `localhost`-only).

### 4.1 `GET /api/health`

Returns `{ "ok": true, "version": "1.0.0" }`. Used by the frontend on load to confirm the server is reachable.

### 4.2 `GET /api/workspaces`

Returns the list of workspaces (see §2.5) — every immediate subdirectory of TASKS_ROOT is listed, even if it has zero tasks or only Closed tasks — plus a synthetic `"all"` entry. Non-directory entries at TASKS_ROOT (e.g. stray files) are ignored.

`taskCount` excludes tasks in the `Closed` lane — a workspace whose only tasks are Closed has `taskCount: 0` but is still listed.

```json
{
  "workspaces": [
    { "id": "all", "name": "All projects", "taskCount": 47 },
    { "id": "home-user-projects-myapp", "name": "home/user/projects/myapp", "taskCount": 12 },
    { "id": "another-workspace", "name": "Another Workspace", "taskCount": 35 },
    { "id": "old-project", "name": "old/project", "taskCount": 0 }
  ]
}
```

`name` is the workspace directory name with dashes converted back to slashes for readability. `taskCount` is the sum of `.md` files across all lanes **except `Closed`**.

### 4.3 `GET /api/workspaces/:id`

Returns the lanes and tasks for one workspace, or for `"all"` (combined).

```json
{
  "workspace": { "id": "home-user-projects-myapp", "name": "home/user/projects/myapp" },
  "lanes": [
    {
      "name": "Backlog",
      "tasks": [
        {
          "filename": "design-auth",
          "title": "Design auth flow",
          "priority": "high",
          "created": "2025-06-10",
          "tags": ["auth", "backend"],
          "workspace": "home-user-projects-myapp"
        }
      ]
    }
  ]
}
```

When `:id === "all"`:
- `lanes` is the union of all lanes across all workspaces, deduplicated.
- Each task's `workspace` field identifies which workspace it belongs to.
- Tasks within each lane are sorted alphabetically by title (case-insensitive).

When `:id` is a specific workspace:
- Tasks within each lane are sorted alphabetically by title (case-insensitive).

### 4.4 `GET /api/tasks/:workspace/:lane/:filename`

Returns the full task content (raw markdown file) plus its rendered HTML.

`:workspace` is the workspace id; `:lane` is the folder name (URL-encoded); `:filename` is the task filename without `.md` (URL-encoded).

```json
{
  "workspace": "home-user-projects-myapp",
  "lane": "Backlog",
  "filename": "design-auth",
  "frontmatter": {
    "id": "uuid-here",
    "title": "Design auth flow",
    "created": "2025-06-10",
    "priority": "high",
    "tags": ["auth", "backend"]
  },
  "body": "# Design auth flow\n\n## Notes\n...",
  "bodyHtml": "<h1>Design auth flow</h1><h2>Notes</h2><p>...</p>",
  "rawMarkdown": "---\nid: uuid-here\n..."
}
```

- `body` is the markdown after the frontmatter (via `parseBody`). It may carry a leading newline from the frontmatter separator; the frontend strips it for display.
- `bodyHtml` is the markdown body (after frontmatter) rendered via `marked` + `DOMPurify` — the rendered Markdown shown in the modal's view mode. `rawMarkdown` is included for transparency / future features.

Returns `404` if the file does not exist.

### 4.5 `POST /api/tasks` — create a task

Creates a task file in the given workspace/lane. Request body (JSON):

```json
{
  "workspace": "home-user-projects-myapp",
  "lane": "Backlog",
  "title": "Design auth flow",
  "priority": "high",
  "tags": ["auth", "backend"],
  "body": "# Design auth flow\n\n## Notes\n"
}
```

- `workspace` (required): an existing workspace id (must be in `GET /api/workspaces`).
- `lane` (optional): target folder, defaults to `Backlog`.
- `title` (required): non-empty string; newlines are collapsed to spaces for frontmatter safety.
- `priority` (optional): one of `low` | `medium` | `high` | `critical`, defaults to `medium`.
- `tags` (optional): array of strings, defaults to `[]`.
- `body` (optional): markdown body string, defaults to `""`.

The server generates the `id` (UUID) and `created` date (today, `YYYY-MM-DD`), and derives the filename from the title (with `-1`, `-2`, … collision suffixes).

Response `201` with the created task:

```json
{
  "workspace": "home-user-projects-myapp",
  "lane": "Backlog",
  "filename": "design-auth",
  "frontmatter": { "id": "uuid-here", "title": "Design auth flow", "created": "2025-06-10", "priority": "high", "tags": ["auth", "backend"] },
  "body": "# Design auth flow\n\n## Notes\n"
}
```

Errors: `400` on invalid body (missing title, bad priority, path separators in workspace/lane, non-array tags, non-string body, invalid JSON), `404` if the workspace does not exist, `500` on other errors.

### 4.6 `PUT /api/tasks/:workspace/:lane/:filename` — update a task

Updates an existing task in place. Request body (JSON) — all fields optional; omitted fields keep their current values:

```json
{
  "title": "Design auth flow v2",
  "priority": "low",
  "tags": ["auth"],
  "body": "# Design auth flow v2\n\n## Notes\n..."
}
```

- The task's `id` and `created` values are always preserved from the file.
- Validation rules match `POST /api/tasks` for the provided fields.
- Path validation matches `GET /api/tasks/:...` (rejects empty segments, path separators, null bytes, path traversal).

Response `200` with the same shape as `GET /api/tasks/:...` (§4.4, including `bodyHtml` and `rawMarkdown`). Returns `404` if the task file does not exist, `400` on invalid input.

### 4.8 `POST /api/tasks/:workspace/:lane/:filename/move` — move a task between lanes

Moves an existing task file from one lane folder to another within the same workspace.

**Request:** JSON body `{ "lane": "Active" }` — the target lane (status folder).

**Response `200`:** the full task payload (same shape as `GET /api/tasks/:...`, §4.4), with the `lane` field reflecting the new location.

**Validation:**

- `lane` (required): non-empty string, no path separators or null bytes — else `400`.
- The task must exist in the source lane — else `404 { error: "Task not found" }`.
- The target lane **must exist** in the workspace (a real subdirectory where tasks may live). Moving to a lane that doesn't exist returns `404 { error: "Lane not found" }` — never auto-creates a status, never silently ignores the request.
- Moving a task to the lane it is already in is a no-op success (`200`).
- Path-traversal guards match `GET /api/tasks/:...`.

**Server behavior:** the file is renamed from `~/.pi/tasks/<workspace>/<srcLane>/<filename>.md` to `~/.pi/tasks/<workspace>/<targetLane>/<filename>.md`, preserving frontmatter (`id`, `created`) and body exactly. Then the task is read back from its new location. Errors other than validation return `500`.

### 4.9 `POST /api/shutdown`

Stops the HTTP server. Returns `200 OK` with `{ "ok": true }` immediately and defers the actual socket close to the next event-loop tick via `setImmediate()`, so the JSON response is fully flushed before the listening socket is torn down.

**Request:** No body required. Any non-POST method on `/api/shutdown` returns `404`.

**Response (200):**

```json
{ "ok": true }
```

**Wire-up:** `startDashboardServer()` registers a module-scoped callback that the route invokes. The callback calls `server.close()` (errors logged, not propagated) and `server.closeAllConnections()` so the listening socket and any keep-alive connections terminate immediately. The extension entry listens for the server's `'close'` event and clears its module-scoped dashboard handle, so a subsequent `/couralabs:task-dashboard` invocation starts a fresh server instead of trying to reuse a dead one.

**Frontend behavior:** the Kill button (see §2.2) fires this endpoint, disables itself, and replaces the page body with a "Dashboard stopped — restart with `/couralabs:task-dashboard`" message. It also tries `window.close()` (best-effort; silently no-ops when the tab wasn't opened via JS).

## 5. Module details

### 5.1 `src/tasks/` — shared task library

Extracted from `index.ts` so both the existing extension commands and the new HTTP server use the same task-loading code. The existing `index.ts` is updated to import from `src/tasks/index.ts` instead of redefining the helpers inline.

Public API:

```ts
// src/tasks/index.ts
export interface Workspace { id: string; name: string; taskCount: number; }
export interface TaskInfo {
    workspace: string;
    lane: string;
    filename: string;
    title: string;
    priority: string;
    created: string;
    tags: string[];
    uuid: string;
}
export interface Lane { name: string; tasks: TaskInfo[]; }
export interface TaskDraft { title: string; priority: string; tags: string[]; body?: string; }

/** Every immediate subdirectory of TASKS_ROOT (taskCount excludes Closed; directories with zero open tasks are still listed). */
export function listWorkspaces(): Promise<Workspace[]>;

/** All lanes (subdirectories) under a workspace, each with its tasks. */
export function listLanes(workspace: string): Promise<Lane[]>;

/** All tasks across all workspaces and lanes, unioned and grouped by lane name. */
export function listAllTasksGroupedByLane(): Promise<Lane[]>;

/** Returns raw markdown file content + parsed frontmatter. */
export function getTaskFile(
    workspace: string,
    lane: string,
    filename: string
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo }>;

/** Create a task file (mkdir lane dir, uuid + today's date, collision-safe filename). */
export function createTaskFile(
    workspace: string,
    lane: string,
    draft: TaskDraft
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null>;

/** Update a task file in place (preserves id + created). */
export function updateTaskFile(
    workspace: string,
    lane: string,
    filename: string,
    draft: TaskDraft
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null>;
```

`listAllTasksGroupedByLane()` computes the union: for each lane name that exists in any workspace, collect tasks from all workspaces that have that lane.

Sorting (case-insensitive alphabetical by title) is applied inside these functions — the API server doesn't need to re-sort.

`createTaskFile` / `updateTaskFile` mirror the extension's `createTask` logic in `index.ts` (same filename sanitization + collision handling, same frontmatter format). `updateTaskFile` reads the existing file first to preserve `id` and `created`; returns `null` when the file doesn't exist.

A new v3 function `moveTaskBetweenLanes(workspace, srcLane, targetLane, filename)` renames the file between lane dirs (creating the target dir, preserving content). `existsLane(workspace, lane)` reports whether a lane dir exists (even when empty).

### 5.2 `src/server/` — HTTP server

- Uses Node's built-in `node:http` (no Express/Fastify).
- Listens on `process.env.TASK_DASHBOARD_PORT ?? 7254`.
- Fail-fast on `EADDRINUSE` — surfaces a clear error message instead of auto-picking a different port.
- Stores the running server instance in the extension closure so it can be inspected (idempotency check) and (eventually) stopped.
- Exposes a single function `startDashboardServer()` that returns `{ url, port, server }` or throws.

The server:
1. Serves static files from `src/server/public/` for any non-`/api/*` path.
2. Reads JSON bodies (capped at 1MB) for write endpoints (`POST /api/tasks`, `PUT /api/tasks/*`) — parse failures return `400 { error: "Invalid JSON body" }`.
3. Routes `GET`/`POST`/`PUT` under `/api/*` to `src/server/routes.ts`.

### 5.3 `src/server/routes.ts`

Thin handlers that call `src/tasks/` functions and shape the JSON responses per §4. No business logic in the routes — just (a) parse URL params, (b) call lib, (c) return JSON.

### 5.4 `src/server/markdown.ts`

Wraps `marked` + `isomorphic-dompurify`:

```ts
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

export function renderMarkdown(md: string): string {
    return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}
```

### 5.5 `src/server/public/` — frontend

#### `index.html`

A minimal HTML5 document:
- `<link>` to local `pico.min.css` (vendored in `src/server/public/vendor/pico.min.css`)
- `<link>` to local `styles.css`
- Markup skeleton: `<header>` (dropdown + refresh + kill), `<main>` (lanes container), `<dialog>` (task modal)
- `<script type="module" src="app.js"></script>`

Pico.css is **vendored locally** (downloaded once, checked in) — no CDN at runtime, no network dependency.

#### `app.js`

Vanilla JS, no framework. State is held in module-scoped variables.

Responsibilities:
- On load: `GET /api/health` → if fails, show error banner.
- `GET /api/workspaces` → populate `<select>` (and remember the real workspaces for the create modal).
- On dropdown change: `GET /api/workspaces/:id` → re-render lanes.
- On `Refresh` click or `r` keypress: re-fetch the current workspace.
- On `Kill` click: `POST /api/shutdown` → replace page body with a "Dashboard stopped" message → best-effort `window.close()`.
- Render each lane as a `<section>` with cards inside.
- **New Task** click → create mode modal (§2.9): pre-filled body (`# Title` + `## Notes`), Save → `POST /api/tasks`; on success close + refresh workspaces + lanes.
- Card click → **view mode**: `GET /api/tasks/:...` → rendered Markdown body, title, meta, Edit + Close buttons.
- **Edit** button → **edit mode**: form fields pre-filled, Save → `PUT /api/tasks/:...`, re-fetch, return to view mode with updated rendered content. Cancel → return to view mode.
- **Close** (button / X / Escape / backdrop) → close modal. Cancel in edit mode → return to view.
- Error messages shown inside the modal; Save button disabled while saving.

A simple `escapeHtml()` helper is used everywhere user-derived strings (titles, tags) are injected into `innerHTML` for card markup, to prevent stored XSS even though we only render content the user wrote themselves.

#### `styles.css`

Small overrides on top of Pico:
- Lanes container: `display: flex; overflow-x: auto; gap: 1rem;`
- Each lane: fixed min-width (~280px), max-height with vertical scroll.
- Priority badge colors (critical/high/medium/low).
- Workspace badge in the corner of cards in "All projects" view.
- Modal: Pico's `<dialog>` element with custom width, plus form styles (create-fields grid, error box, right-aligned footer, resizable textarea).

## 6. Extension integration

### 6.1 New slash command

`pi.registerCommand("couralabs:task-dashboard", { description, handler })` is added to `index.ts`. The handler:

1. If the dashboard server is already running, build `<baseUrl>?workspace=<cwdWorkspaceId>` (where `<cwdWorkspaceId>` is `getWorkspaceName(ctx.cwd)`, validated against `^[A-Za-z0-9_-]+$`) and call `openBrowser(...)` on it. If the id is empty or unsafe, use `<baseUrl>` without the query string. Return.
2. Otherwise, call `startDashboardServer()`. On success, store the handle in the closure, build `<baseUrl>?workspace=<cwdWorkspaceId>` (same rules as step 1) and call `openBrowser(...)` on it. `ctx.ui.notify` the base URL.
3. On `EADDRINUSE`, `ctx.ui.notify` the error and include the hint to set `TASK_DASHBOARD_PORT`.

### 6.2 Browser opening

Reuses the existing cross-platform pattern from `openTaskFileInEditor` in `index.ts`:

```ts
function openBrowser(url: string): void {
    const cmd = process.platform === "darwin" ? "open"
              : process.platform === "win32"  ? "start"
              : "xdg-open";
    execAsync(`${cmd} "${url}"`).catch(() => { /* swallow: URL was already notified */ });
}
```

If `process.env.BROWSER === "none"` (CI / SSH), skip the spawn — the URL is still surfaced via `ctx.ui.notify`.

### 6.3 Idempotency

The server handle (`{ url, port, server }`) is stored in a module-scoped variable inside `index.ts`. On the second invocation, the handler checks this variable and reuses.

### 6.4 No auto-shutdown

Per §2.1, the server is intentionally not stopped on `session_shutdown`. The user explicitly chose simplicity. The dashboard's Kill button (§2.2 / §4.9) is the supported way to stop the server from the browser; the extension's server handle is cleared on the `'close'` event so a subsequent `/couralabs:task-dashboard` invocation starts a fresh server. If a stale server is somehow left behind (e.g. the user closed the browser without clicking Kill), the next `/couralabs:task-dashboard` invocation will fail with `EADDRINUSE` and the error message tells the user what to do.

## 7. Dependencies

Add to `package.json`:

- `dependencies`:
  - `"marked": "^14.0.0"` — markdown → HTML
  - `"isomorphic-dompurify": "^2.0.0"` — HTML sanitization (works in Node and browser)
  - `"open": "^10.0.0"` — cross-platform `xdg-open`/`open`/`start` invocation (replaces the existing inline `execAsync` pattern, smaller surface area than shelling out)
- `devDependencies`: none new — `typescript` is already declared

`ws` is available in `node_modules` but **not** used (REST only). It can stay as a transitive dep.

Pico.css is **not** an npm dep — it's vendored as `src/server/public/vendor/pico.min.css` (single file, ~10KB minified). This avoids a build step and keeps the install footprint small.

## 8. Implementation order

Build in this order so each step is independently verifiable:

1. **Extract `src/tasks/`** — pull task-loading helpers out of `index.ts` into `src/tasks/{index,frontmatter,paths}.ts`. Verify `/tasks`, `/task-active`, `/task-create` etc. still work via manual reload. **No behavior change.**
2. **`src/server/markdown.ts`** — `renderMarkdown()` with `marked` + DOMPurify. Trivially testable via a Vitest unit test.
3. **`src/server/index.ts` + `routes.ts`** — HTTP server with the read API endpoints. Testable via curl/`fetch`.
4. **`src/server/public/index.html` + `app.js` + `styles.css`** — frontend (read-only v1). Iterate in the browser.
5. **Vendor `pico.min.css`** — drop the file into `src/server/public/vendor/`.
6. **Wire `/couralabs:task-dashboard` in `index.ts`** — register command, integrate `openBrowser()`, idempotency, error handling.
7. **Smoke test** — start pi, run `/couralabs:task-dashboard`, verify the dashboard loads, switching workspaces works, modals open and close, refresh works.
8. **v2: write APIs** — add `createTaskFile`/`updateTaskFile` to `src/tasks/`, `POST /api/tasks` + `PUT /api/tasks/:...` to routes, JSON body parsing to the server. Vitest + smoke-test round-trip (create/update/delete).
9. **v2: frontend create/edit** — New Task button, modal form (create + edit modes), Save wiring, error display. Verified in the browser.

## 9. Acceptance criteria

- [ ] `/couralabs:task-dashboard` opens the dashboard in the browser.
- [ ] The project dropdown lists "All projects" + every workspace directory (see §2.5).
- [ ] Selecting "All projects" shows the union of all lanes across all workspaces; each card displays its workspace badge; tasks in each lane are sorted alphabetically by title.
- [ ] Selecting a specific workspace shows only its lanes and tasks; tasks sorted alphabetically by title.
- [ ] Every workspace directory appears in the dropdown, even with zero tasks or only Closed tasks (a zero-open-task workspace shows `taskCount: 0`).
- [ ] Lanes are dynamic — any subdirectory under a workspace appears as a lane, not just `Backlog`/`Active`/`user-qa`/`Closed`.
- [ ] Clicking a card opens the edit modal with title, priority, tags, and body pre-filled; the modal shows the created date and workspace/lane breadcrumb.
- [ ] Modal closes via click outside, X button, Cancel, or Escape.
- [ ] `r` keyboard shortcut (or Refresh button) re-fetches data.
- [ ] Running `/couralabs:task-dashboard` twice reuses the same server and just reopens the tab.
- [ ] The Kill button stops the server and renders a "Dashboard stopped" page; a subsequent `/couralabs:task-dashboard` invocation starts a fresh server.
- [ ] If the port is in use, the user gets a clear error via `ctx.ui.notify` with the `TASK_DASHBOARD_PORT` hint.
- [ ] Markdown is sanitized — script tags injected into a task title do not execute.
- [ ] Existing extension commands (`/tasks`, `/task-active`, `/task-create`, etc.) still work — no regressions from the `src/tasks/` refactor.
- [ ] **New Task** button (left of Refresh) opens the create modal; the Notes body is pre-populated with the header style (`# Title` + `## Notes`) and the meta shows today's date.
- [ ] Creating a task writes a valid task file (frontmatter with uuid/created/priority/tags + body) to the selected workspace/lane; the placeholder `# Title` H1 is replaced with the real title.
- [ ] Editing a task and saving updates the file in place; `id` and `created` are preserved.
- [ ] The Save button is disabled while saving; save errors are shown inside the modal and the modal stays open.
- [ ] The New Task button is disabled when no workspaces exist.
- [ ] `POST /api/tasks` returns 400 on invalid input (empty title, bad priority, path separators) and 404 for an unknown workspace.
- [ ] `PUT /api/tasks/:...` returns 400 on invalid input and 404 for a missing task; omitted fields keep their current values.
- [ ] Cards are draggable; dropping a card onto an existing lane in the same workspace moves the task file to that lane and re-renders.
- [ ] Drafting/dragging over a lane shows a drop indicator; dropping onto a lane that does not exist for the card's workspace is rejected (card stays put, visible error indication, no silent no-op).
- [ ] In "All projects" view, a card can only be dropped into a lane that exists in its own workspace.
- [ ] `POST /api/tasks/:ws/:lane/:file/move` moves the file, preserves id/created/body, returns 200 with the updated task; returns 400 on invalid params, 404 for a missing task, and 404 for a non-existent target lane.