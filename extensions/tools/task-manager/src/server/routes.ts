import { resolve } from "node:path";
import { TASKS_ROOT } from "../tasks/index.ts";
import type { Workspace, Lane, TaskInfo, TaskDraft } from "../tasks/index.ts";
import {
    listWorkspaces,
    listLanes,
    listAllTasksGroupedByLane,
    getTaskFile,
    createTaskFile,
    updateTaskFile,
    moveTaskBetweenLanes,
    existsLane,
    parseBody,
} from "../tasks/index.ts";
import { renderMarkdown } from "./markdown.ts";

/**
 * Discriminated-union response shape used by every route handler. The HTTP
 * layer in `index.ts` translates `status` into an HTTP status code and
 * `body` into the JSON response payload.
 */
export type RouteResponse =
    | { status: 200; body: unknown }
    | { status: 201; body: unknown }
    | { status: 400 | 404 | 500; body: { error: string } };

/** Fixed version string surfaced by `GET /api/health`. */
const SERVER_VERSION = "1.0.0";

/** Valid priority values for task frontmatter. */
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

/** Build the JSON 200 response. */
function ok(body: unknown): RouteResponse {
    return { status: 200, body };
}

/** Build the JSON 201 response. */
function created(body: unknown): RouteResponse {
    return { status: 201, body };
}

/** Build a JSON error response with the given status. */
function err(status: 400 | 404 | 500, error: string): RouteResponse {
    return { status, body: { error } };
}

/**
 * Resolve `p` against `TASKS_ROOT` and verify the result stays inside it.
 * Returns the absolute path on success, or `null` if the path would escape
 * the tasks root (path traversal attempt).
 */
function safeResolve(...parts: string[]): string | null {
    const joined = resolve(TASKS_ROOT, ...parts);
    const rootWithSep = TASKS_ROOT.endsWith("/") || TASKS_ROOT.endsWith("\\")
        ? TASKS_ROOT
        : TASKS_ROOT + "/";
    // On Windows `resolve` normalizes to backslashes; on POSIX to forward.
    // Use case-insensitive prefix check on Windows to match filesystem
    // semantics, exact on POSIX.
    const isWin = process.platform === "win32";
    const root = isWin ? rootWithSep.toLowerCase() : rootWithSep;
    const target = isWin ? joined.toLowerCase() : joined;
    if (!target.startsWith(root) && target !== (isWin ? TASKS_ROOT.toLowerCase() : TASKS_ROOT)) {
        return null;
    }
    return joined;
}

/**
 * True if a URL-path segment must be rejected. Blocks path separators, null
 * bytes, and the `.` / `..` segments which `path.resolve` would normalize
 * into parent traversal — `safeResolve` alone cannot catch those because
 * `resolve(TASKS_ROOT, ws, "..")` stays inside (or at) `TASKS_ROOT`.
 *
 * Used for workspace / lane / filename segments.
 */
function hasUnsafePathSegment(seg: string): boolean {
    return (
        seg === "." ||
        seg === ".." ||
        seg.includes("/") ||
        seg.includes("\\") ||
        seg.includes("\0")
    );
}

/**
 * `GET /api/health` — liveness probe. Per spec §4.1.
 */
export async function handleHealth(): Promise<RouteResponse> {
    return ok({ ok: true, version: SERVER_VERSION });
}

/**
 * `POST /api/shutdown` — stop the HTTP server. Returns 200 immediately
 * and triggers `stop()` in the background so the response can be flushed
 * before the listening socket closes.
 *
 * `stop` is injected (rather than imported from `./index.js`) to avoid a
 * circular dependency: `index.ts` wires the route, `routes.ts` calls back
 * through the closure. The caller is responsible for handling the actual
 * server teardown (and clearing the module-scoped handle in `index.ts`).
 */
export async function handleShutdown(stop: () => void): Promise<RouteResponse> {
    // Fire-and-forget — defer to the next tick so the JSON response is
    // fully serialized and buffered before the server starts closing
    // sockets.
    setImmediate(() => {
        try {
            stop();
        } catch {
            /* swallow — server is going away */
        }
    });
    return ok({ ok: true });
}

/**
 * `GET /api/workspaces` — list all workspaces (every immediate subdirectory
 * of TASKS_ROOT, even ones with zero open tasks) plus a synthetic
 * `"all"` entry whose `taskCount` is the sum across all workspaces.
 * Per spec §4.2.
 */
export async function handleListWorkspaces(): Promise<RouteResponse> {
    const workspaces = await listWorkspaces();
    const total = workspaces.reduce((sum, w) => sum + w.taskCount, 0);
    const all: Workspace = {
        id: "all",
        name: "All projects",
        taskCount: total,
    };
    return ok({ workspaces: [all, ...workspaces] });
}

/**
 * `GET /api/workspaces/:id` — lanes + tasks for one workspace, or for
 * `"all"` (union across all workspaces). Per spec §4.3.
 *
 * `id` must already be URL-decoded by the caller.
 */
export async function handleGetWorkspace(id: string): Promise<RouteResponse> {
    if (id === "all") {
        const lanes = await listAllTasksGroupedByLane();
        const workspace = { id: "all", name: "All projects" };
        return ok({ workspace, lanes });
    }

    // Validate the workspace id doesn't try to escape TASKS_ROOT.
    const safe = safeResolve(id);
    if (safe === null) {
        return err(400, "Invalid workspace id");
    }

    const workspaces = await listWorkspaces();
    const match = workspaces.find(w => w.id === id);
    if (!match) {
        return err(404, "Workspace not found");
    }

    const lanes = await listLanes(id);
    return ok({
        workspace: { id: match.id, name: match.name },
        lanes,
    });
}

/**
 * Build the shared task-detail payload used by `GET` and `PUT` responses:
 * frontmatter + raw markdown + sanitized HTML body + plain markdown body.
 */
function buildTaskDetailResponse(result: {
    rawMarkdown: string;
    frontmatter: TaskInfo;
}): unknown {
    return {
        workspace: result.frontmatter.workspace,
        lane: result.frontmatter.lane,
        filename: result.frontmatter.filename,
        frontmatter: {
            id: result.frontmatter.uuid,
            title: result.frontmatter.title,
            created: result.frontmatter.created,
            priority: result.frontmatter.priority,
            tags: result.frontmatter.tags,
        },
        bodyHtml: renderMarkdown(parseBody(result.rawMarkdown)),
        rawMarkdown: result.rawMarkdown,
        body: parseBody(result.rawMarkdown),
    };
}

/**
 * Build the `POST /api/tasks` 201 payload: frontmatter + plain markdown
 * body (no HTML/raw duplication).
 */
function buildTaskCreatedResponse(result: {
    rawMarkdown: string;
    frontmatter: TaskInfo;
}): unknown {
    return {
        workspace: result.frontmatter.workspace,
        lane: result.frontmatter.lane,
        filename: result.frontmatter.filename,
        frontmatter: {
            id: result.frontmatter.uuid,
            title: result.frontmatter.title,
            created: result.frontmatter.created,
            priority: result.frontmatter.priority,
            tags: result.frontmatter.tags,
        },
        body: parseBody(result.rawMarkdown),
    };
}

/**
 * `GET /api/tasks/:workspace/:lane/:filename` — full task payload (frontmatter
 * + raw markdown + sanitized HTML body + plain markdown body). Per spec §4.4.
 *
 * All three params must already be URL-decoded by the caller.
 */
export async function handleGetTask(
    workspace: string,
    lane: string,
    filename: string,
): Promise<RouteResponse> {
    // Reject empty strings early.
    if (!workspace || !lane || !filename) {
        return err(400, "Invalid task path");
    }
    // Reject anything containing path separators or null bytes — the URL
    // regex in `index.ts` already enforces single-segment values, but this
    // is defensive. `.` / `..` are rejected too (they normalize to parent
    // traversal via `path.resolve` even from inside TASKS_ROOT).
    for (const seg of [workspace, lane, filename]) {
        if (hasUnsafePathSegment(seg)) {
            return err(400, "Invalid task path");
        }
    }
    // Path-traversal guard: ensure resolved path stays inside TASKS_ROOT.
    const safe = safeResolve(workspace, lane, `${filename}.md`);
    if (safe === null) {
        return err(400, "Invalid task path");
    }

    const result = await getTaskFile(workspace, lane, filename);
    if (result === null) {
        return err(404, "Task not found");
    }

    return ok(buildTaskDetailResponse(result));
}

/**
 * `POST /api/tasks` — create a task in the given workspace/lane.
 * Request body: `{ workspace, lane?, title, priority?, tags?, body? }`.
 * Returns 201 with the created task (frontmatter + body).
 */
export async function handleCreateTask(body: unknown): Promise<RouteResponse> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return err(400, "Invalid JSON body");
    }
    const b = body as Record<string, unknown>;

    const workspace = b.workspace;
    if (typeof workspace !== "string" || workspace.length === 0) {
        return err(400, "Invalid workspace");
    }
    if (workspace.includes("/") || workspace.includes("\\") || workspace.includes("\0")) {
        return err(400, "Invalid workspace");
    }

    const lane = b.lane === undefined ? "Backlog" : b.lane;
    if (typeof lane !== "string" || lane.length === 0) {
        return err(400, "Invalid lane");
    }
    if (lane.includes("/") || lane.includes("\\") || lane.includes("\0")) {
        return err(400, "Invalid lane");
    }

    const title = b.title;
    if (typeof title !== "string" || title.trim().length === 0) {
        return err(400, "Invalid title");
    }

    const priority = b.priority === undefined ? "medium" : b.priority;
    if (typeof priority !== "string" || !(PRIORITIES as readonly string[]).includes(priority)) {
        return err(400, "Invalid priority");
    }

    const tags = b.tags === undefined ? [] : b.tags;
    if (!Array.isArray(tags) || tags.some(t => typeof t !== "string")) {
        return err(400, "Invalid tags");
    }

    const bodyText = b.body === undefined ? "" : b.body;
    if (typeof bodyText !== "string") {
        return err(400, "Invalid body");
    }

    try {
        const workspaces = await listWorkspaces();
        if (!workspaces.some(w => w.id === workspace)) {
            return err(404, "Workspace not found");
        }

        const result = await createTaskFile(workspace, lane, {
            title,
            priority,
            tags,
            body: bodyText,
        });
        if (result === null) {
            return err(400, "Invalid lane");
        }
        return created(buildTaskCreatedResponse(result));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[task-dashboard] create task error:", e);
        return err(500, "Internal server error");
    }
}

/**
 * `PUT /api/tasks/:workspace/:lane/:filename` — update an existing task.
 * Request body: `{ title?, priority?, tags?, body? }` — all optional; omitted
 * fields keep their current values (id + created preserved from the file).
 * Returns 200 with the same shape as `GET`.
 */
export async function handleUpdateTask(
    workspace: string,
    lane: string,
    filename: string,
    body: unknown,
): Promise<RouteResponse> {
    // Reject empty strings early.
    if (!workspace || !lane || !filename) {
        return err(400, "Invalid task path");
    }
    // Reject anything containing path separators or null bytes.
    for (const seg of [workspace, lane, filename]) {
        if (hasUnsafePathSegment(seg)) {
            return err(400, "Invalid task path");
        }
    }
    // Path-traversal guard: ensure resolved path stays inside TASKS_ROOT.
    const safe = safeResolve(workspace, lane, `${filename}.md`);
    if (safe === null) {
        return err(400, "Invalid task path");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return err(400, "Invalid JSON body");
    }
    const b = body as Record<string, unknown>;

    // Validate the optional fields (with defaults filled in from the file).
    let title: string | undefined;
    if (b.title !== undefined) {
        if (typeof b.title !== "string" || b.title.trim().length === 0) {
            return err(400, "Invalid title");
        }
        title = b.title;
    }

    let priority: string | undefined;
    if (b.priority !== undefined) {
        if (typeof b.priority !== "string" || !(PRIORITIES as readonly string[]).includes(b.priority)) {
            return err(400, "Invalid priority");
        }
        priority = b.priority;
    }

    let tags: string[] | undefined;
    if (b.tags !== undefined) {
        if (!Array.isArray(b.tags) || b.tags.some(t => typeof t !== "string")) {
            return err(400, "Invalid tags");
        }
        tags = b.tags;
    }

    let bodyText: string | undefined;
    if (b.body !== undefined) {
        if (typeof b.body !== "string") {
            return err(400, "Invalid body");
        }
        bodyText = b.body;
    }

    try {
        // Load the current task so omitted fields keep their values.
        const existing = await getTaskFile(workspace, lane, filename);
        if (existing === null) {
            return err(404, "Task not found");
        }

        const draft: TaskDraft = {
            title: title ?? existing.frontmatter.title,
            priority: priority ?? existing.frontmatter.priority,
            tags: tags ?? existing.frontmatter.tags,
            body: bodyText ?? parseBody(existing.rawMarkdown),
        };

        const result = await updateTaskFile(workspace, lane, filename, draft);
        if (result === null) {
            return err(404, "Task not found");
        }
        return ok(buildTaskDetailResponse(result));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[task-dashboard] update task error:", e);
        return err(500, "Internal server error");
    }
}

/**
 * `POST /api/tasks/:workspace/:lane/:filename/move` — move an existing task
 * between lanes within the same workspace. Request body: `{ lane: string }`
 * (the target lane). Returns 200 with the same shape as `GET` (§4.4), with
 * `lane` reflecting the new location. Per spec §4.8.
 *
 * Strict lane validation: the target lane must be a real (existing) status
 * folder in the workspace — never auto-created, never silently ignored. The
 * lane check runs BEFORE the task-existence check so `404 Lane not found`
 * wins when both are invalid.
 */
export async function handleMoveTask(
    workspace: string,
    lane: string,
    filename: string,
    body: unknown,
): Promise<RouteResponse> {
    // Reject empty strings early.
    if (!workspace || !lane || !filename) {
        return err(400, "Invalid task path");
    }
    // Reject anything containing path separators, null bytes, or `.` / `..`
    // (which would normalize to parent traversal via `path.resolve`).
    for (const seg of [workspace, lane, filename]) {
        if (hasUnsafePathSegment(seg)) {
            return err(400, "Invalid task path");
        }
    }
    // Path-traversal guard: ensure resolved path stays inside TASKS_ROOT.
    const safe = safeResolve(workspace, lane, `${filename}.md`);
    if (safe === null) {
        return err(400, "Invalid task path");
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return err(400, "Invalid JSON body");
    }
    const b = body as Record<string, unknown>;

    const targetLane = b.lane;
    if (typeof targetLane !== "string" || targetLane.length === 0) {
        return err(400, "Invalid lane");
    }
    // The target lane is also a path segment: reject separators, null
    // bytes, and `.` / `..` so the strict lane check can never be bypassed
    // into the workspace root or TASKS_ROOT.
    if (hasUnsafePathSegment(targetLane)) {
        return err(400, "Invalid lane");
    }

    try {
        // STRICT: the target lane must be a real folder in the workspace.
        if (!(await existsLane(workspace, targetLane))) {
            return err(404, "Lane not found");
        }

        // Same-lane no-op: return the current task payload unchanged.
        if (targetLane === lane) {
            const current = await getTaskFile(workspace, lane, filename);
            if (current === null) {
                return err(404, "Task not found");
            }
            return ok(buildTaskDetailResponse(current));
        }

        const result = await moveTaskBetweenLanes(workspace, lane, targetLane, filename);
        if (result === null) {
            return err(404, "Task not found");
        }
        return ok(buildTaskDetailResponse(result));
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[task-dashboard] move task error:", e);
        return err(500, "Internal server error");
    }
}

// Re-exported for tests so they don't need to import from `tasks/index.js`
// separately when constructing fixtures.
export type { Workspace, Lane };
