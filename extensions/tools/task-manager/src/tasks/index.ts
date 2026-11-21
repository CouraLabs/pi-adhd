import { resolve, join } from "node:path";
import { readdir, readFile, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseFrontmatter, parseBody } from "./frontmatter.ts";
import { TASKS_ROOT } from "./paths.ts";

export { TASKS_ROOT, getWorkspaceName } from "./paths.ts";
export { parseFrontmatter, parseBody } from "./frontmatter.ts";
export type { Frontmatter } from "./frontmatter.ts";
export {
    TASKS_ACTIONS,
    ACTION_SPECS,
    ALL_TASKS_PARAMS,
    TasksParamsSchema,
    validateTasksParams,
    emptyResultHint,
} from "./tool-params.ts";
export type {
    TasksAction,
    TasksParams,
    ActionSpec,
    RequiredGroup,
    TasksParamProblem,
} from "./tool-params.ts";

/** Hardcoded list of lane folders used by the existing extension commands. */
export const FOLDERS = ["Backlog", "Active", "user-qa", "Closed"] as const;

export interface Workspace {
    id: string;
    name: string;
    taskCount: number;
}

export interface TaskInfo {
    workspace: string;
    lane: string;
    filename: string;
    title: string;
    priority: string;
    created: string;
    tags: string[];
    uuid: string;
    /**
     * Markdown body (content after the frontmatter block). Only populated
     * when the caller asks for the body via `listTasksInLane` (e.g. the
     * dashboard workspace payload); other code paths may omit it.
     */
    body?: string;
    /**
     * Backward-compat alias for `lane`. Existing extension code references
     * `task.folder` heavily; keep it populated with the same value.
     */
    folder: string;
}

export interface Lane {
    name: string;
    tasks: TaskInfo[];
}

/**
 * Like `readdir` but returns `[]` when the directory does not exist.
 * Returns `[]` for `ENOTDIR` as well — used when scanning a directory where
 * some entries may be regular files (not subdirs).
 */
export async function readdirOrEmpty(dir: string): Promise<string[]> {
    try {
        return await readdir(dir);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return [];
        throw err;
    }
}

/**
 * True if the given path is a directory. Returns false if `stat` fails.
 */
async function isDirectory(p: string): Promise<boolean> {
    try {
        const s = await stat(p);
        return s.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Count open `.md` tasks in a workspace dir: every lane subdirectory except
 * `Closed`, files at the workspace root ignored. Used by `listWorkspaces`
 * to populate the `taskCount` field shown in the dropdown.
 */
async function countOpenTaskFiles(workspaceDir: string): Promise<number> {
    const entries = await readdirOrEmpty(workspaceDir);
    let count = 0;
    for (const entry of entries) {
        if (entry === "Closed") continue;
        const subDir = join(workspaceDir, entry);
        if (!(await isDirectory(subDir))) continue;
        const files = await readdirOrEmpty(subDir);
        count += files.filter(f => f.endsWith(".md")).length;
    }
    return count;
}

/**
 * List all tasks in a single lane for a workspace.
 * Returns TaskInfo[] (empty if the lane dir doesn't exist or has no .md files).
 */
export async function listTasksInLane(workspace: string, lane: string): Promise<TaskInfo[]> {
    const dir = resolve(TASKS_ROOT, workspace, lane);
    const files = await readdirOrEmpty(dir);

    const tasks: TaskInfo[] = [];
    for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const filePath = resolve(dir, file);
        try {
            const content = await readFile(filePath, "utf8");
            const fm = parseFrontmatter(content);
            const baseName = file.replace(/\.md$/, "");
            tasks.push({
                workspace,
                lane,
                folder: lane,
                filename: baseName,
                title: fm.title,
                priority: fm.priority,
                created: fm.created,
                tags: fm.tags,
                uuid: fm.id,
                body: parseBody(content),
            });
        } catch {
            continue;
        }
    }
    return tasks;
}

/**
 * Get all tasks across the four hardcoded folders for a workspace.
 */
export async function getAllTasksForWorkspace(workspace: string): Promise<Lane[]> {
    return Promise.all(
        FOLDERS.map(async (folder): Promise<Lane> => ({
            name: folder,
            tasks: await listTasksInLane(workspace, folder),
        })),
    );
}

/**
 * Drop the Closed lane. Used by the tasks tool's default list output so
 * Closed tasks are hidden unless the caller opts in with includeClosed.
 */
export function dropClosedLane(lanes: Lane[]): Lane[] {
    return lanes.filter(l => l.name !== "Closed");
}

/**
 * All workspace directories under `TASKS_ROOT`, including empty ones. A
 * **workspace** is any immediate subdirectory of `TASKS_ROOT`; every such
 * directory is returned, even if it has zero tasks or its only tasks are in
 * `Closed`. Regular files at `TASKS_ROOT` are ignored.
 *
 * `taskCount` counts `.md` files across all lane subdirectories
 * **except `Closed`** — i.e. open work only. A workspace whose tasks are
 * all in `Closed` shows `taskCount: 0` even though it has tasks on disk.
 *
 * The `name` field is the directory name with dashes converted back to
 * slashes for readability (e.g. `home-user-projects-myapp` →
 * `home/user/projects/myapp`).
 */
export async function listWorkspaces(): Promise<Workspace[]> {
    const entries = await readdirOrEmpty(TASKS_ROOT);
    const result: Workspace[] = [];

    for (const entry of entries) {
        const dir = join(TASKS_ROOT, entry);
        if (!(await isDirectory(dir))) continue;
        const taskCount = await countOpenTaskFiles(dir);

        result.push({
            id: entry,
            name: entry.replace(/-/g, "/"),
            taskCount,
        });
    }

    return result;
}

/**
 * Rank of a lane for dashboard ordering.
 * Default sequence: Backlog → Active → QA (user-qa) → Closed.
 * Any other lane ranks after Closed. Matching is case-insensitive.
 */
function laneRank(name: string): number {
    switch (name.trim().toLowerCase()) {
        case "backlog":
            return 0;
        case "active":
            return 1;
        case "user-qa":
        case "qa":
            return 2;
        case "closed":
            return 3;
        default:
            return 4;
    }
}

/** Order lanes: default sequence first, then case-insensitive alphabetically. */
function compareLanes(a: Lane, b: Lane): number {
    const rankA = laneRank(a.name);
    const rankB = laneRank(b.name);
    if (rankA !== rankB) return rankA - rankB;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/**
 * List the lanes (subdirectories) of a workspace. **Every** subdirectory is
 * returned as a lane, including ones with zero tasks — so empty status
 * folders still show on the dashboard. No defaults are invented: a
 * workspace with no subdirectories returns `[]`.
 *
 * Ordered Backlog → Active → QA → Closed, then any other lanes
 * case-insensitive alphabetically.
 */
export async function listLanes(workspace: string): Promise<Lane[]> {
    const wsDir = join(TASKS_ROOT, workspace);
    const entries = await readdirOrEmpty(wsDir);
    const lanes: Lane[] = [];

    for (const entry of entries) {
        const dir = join(wsDir, entry);
        if (!(await isDirectory(dir))) continue;
        const tasks = await listTasksInLane(workspace, entry);
        lanes.push({ name: entry, tasks });
    }

    lanes.sort(compareLanes);
    return lanes;
}

/**
 * Union of all lanes across all workspaces, grouped by lane name
 * (case-sensitive). For each lane name, collects tasks from every workspace
 * that has that lane. Workspaces with no tasks contribute empty lanes to
 * the union. Tasks within each lane are sorted alphabetically by title.
 * Lanes are ordered Backlog → Active → QA → Closed, then any other
 * lanes case-insensitive alphabetically.
 */
export async function listAllTasksGroupedByLane(): Promise<Lane[]> {
    const workspaces = await listWorkspaces();
    const laneMap = new Map<string, TaskInfo[]>();

    for (const ws of workspaces) {
        const lanes = await listLanes(ws.id);
        for (const lane of lanes) {
            const existing = laneMap.get(lane.name) ?? [];
            existing.push(...lane.tasks);
            laneMap.set(lane.name, existing);
        }
    }

    const result: Lane[] = [];
    for (const [name, tasks] of laneMap) {
        const sorted = [...tasks].sort((a, b) =>
            a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
        );
        result.push({ name, tasks: sorted });
    }

    result.sort(compareLanes);
    return result;
}

/**
 * Returns the raw markdown content of a task file plus its parsed frontmatter.
 * Returns `null` if the file does not exist.
 */
export async function getTaskFile(
    workspace: string,
    lane: string,
    filename: string,
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null> {
    const filePath = resolve(TASKS_ROOT, workspace, lane, `${filename}.md`);
    let raw: string;
    try {
        raw = await readFile(filePath, "utf8");
    } catch {
        return null;
    }

    const fm = parseFrontmatter(raw);
    const frontmatter: TaskInfo = {
        workspace,
        lane,
        folder: lane,
        filename,
        title: fm.title,
        priority: fm.priority,
        created: fm.created,
        tags: fm.tags,
        uuid: fm.id,
    };

    return { rawMarkdown: raw, frontmatter };
}

/**
 * Normalize a string for task matching: lowercase and replace any sequence of
 * non-alphanumeric chars with single dash; strip leading/trailing dashes.
 */
export function normalizeTaskName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Write-side draft for creating/updating a task file. All fields except
 * `body` are required; the HTTP layer fills in current values for any
 * omitted fields before calling the write functions.
 */
export interface TaskDraft {
    title: string;
    priority: string;
    tags: string[];
    body?: string;
}

/**
 * Serialize the tags array as a YAML block under `tags:`. Empty tags
 * produce just the `tags:` line (matching existing task files).
 */
function serializeTags(tags: string[]): string {
    if (tags.length === 0) return "tags:";
    return `tags:\n${tags.map(t => `  - ${t}`).join("\n")}`;
}

/**
 * Build the raw markdown for a task file from the given fields.
 * Format matches the existing task files on disk:
 *
 * ```
 * ---
 * id: <uuid>
 * title: <title>
 * created: <YYYY-MM-DD>
 * priority: <priority>
 * tags:
 *   - tag1
 * ---
 *
 * <body>
 * ```
 */
function buildTaskMarkdown(
    id: string,
    created: string,
    priority: string,
    tags: string[],
    title: string,
    body: string,
): string {
    // Sanitize the title for frontmatter safety: newlines/CR would break
    // the YAML block, so collapse them to spaces.
    const safeTitle = title.replace(/[\r\n]+/g, " ");
    return `---\nid: ${id}\ntitle: ${safeTitle}\ncreated: ${created}\npriority: ${priority}\n${serializeTags(tags)}\n---\n\n${body}`;
}

/**
 * Create a task file in the given workspace/lane. Returns the raw markdown
 * plus parsed frontmatter, or `null` if the lane contains path separators.
 *
 * Workspace/lane dirs are created recursively as needed. Collisions with
 * existing filenames are resolved by appending `-1`, `-2`, ... like the
 * extension's `createTask` in `index.ts`.
 */
export async function createTaskFile(
    workspace: string,
    lane: string,
    draft: TaskDraft,
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null> {
    if (!lane || lane.includes("/") || lane.includes("\\") || lane.includes("\0")) {
        return null;
    }

    const dir = resolve(TASKS_ROOT, workspace, lane);
    await mkdir(dir, { recursive: true });

    const id = randomUUID();
    const created = new Date().toISOString().slice(0, 10);
    const safeTitle = draft.title.replace(/[\r\n]+/g, " ");
    const safeName = safeTitle.replace(/[^\w\-]/g, "-").replace(/-+/g, "-");

    let fileName = `${safeName}.md`;
    let filePath = resolve(dir, fileName);
    let i = 1;
    try {
        while (await stat(filePath)) {
            fileName = `${safeName}-${i}.md`;
            filePath = resolve(dir, fileName);
            i++;
        }
    } catch {
        // File doesn't exist — that's what we want.
    }

    const rawMarkdown = buildTaskMarkdown(id, created, draft.priority, draft.tags, safeTitle, draft.body ?? "");
    await writeFile(filePath, rawMarkdown, "utf8");

    const frontmatter: TaskInfo = {
        workspace,
        lane,
        folder: lane,
        filename: fileName.replace(/\.md$/, ""),
        title: safeTitle,
        priority: draft.priority,
        created,
        tags: draft.tags,
        uuid: id,
    };

    return { rawMarkdown, frontmatter };
}

/**
 * Update an existing task file (identified by workspace/lane/filename).
 * Reads the file first to preserve its `id` and `created` values, then
 * rewrites it with the new title/priority/tags/body. Returns `null` if the
 * file does not exist.
 */
export async function updateTaskFile(
    workspace: string,
    lane: string,
    filename: string,
    draft: TaskDraft,
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null> {
    const filePath = resolve(TASKS_ROOT, workspace, lane, `${filename}.md`);
    let raw: string;
    try {
        raw = await readFile(filePath, "utf8");
    } catch {
        return null;
    }

    const existing = parseFrontmatter(raw);
    const id = existing.id;
    const created = existing.created;
    const safeTitle = draft.title.replace(/[\r\n]+/g, " ");
    const rawMarkdown = buildTaskMarkdown(id, created, draft.priority, draft.tags, safeTitle, draft.body ?? "");
    await writeFile(filePath, rawMarkdown, "utf8");

    const frontmatter: TaskInfo = {
        workspace,
        lane,
        folder: lane,
        filename,
        title: safeTitle,
        priority: draft.priority,
        created,
        tags: draft.tags,
        uuid: id,
    };

    return { rawMarkdown, frontmatter };
}

/**
 * True if the lane directory `TASKS_ROOT/workspace/lane` exists — even when
 * it is empty (an empty status folder is still a real status, crucial for
 * the strict move validation). Returns false if `workspace` or `lane` looks
 * malicious (empty, path separators, null bytes, `.` / `..`) or the
 * directory is absent.
 */
export async function existsLane(workspace: string, lane: string): Promise<boolean> {
    for (const seg of [workspace, lane]) {
        if (!seg || hasUnsafeSegment(seg)) {
            return false;
        }
    }
    return isDirectory(resolve(TASKS_ROOT, workspace, lane));
}

/**
 * True if a path segment would let `path.resolve` escape the intended
 * parent dir (`..` / `.`) or cross segment boundaries (separators, NUL).
 * Shared by `existsLane` and `moveTaskBetweenLanes`. Note: this is a
 * structural guard — `resolve` would normalize `..` away before any
 * filesystem call, so rejecting here keeps every lookup inside the lane.
 */
function hasUnsafeSegment(seg: string): boolean {
    return (
        seg === "." ||
        seg === ".." ||
        seg.includes("/") ||
        seg.includes("\\") ||
        seg.includes("\0")
    );
}

/**
 * Move a task file between lane directories within the same workspace.
 * Creates the target lane dir (recursively) if needed, then renames the
 * file. Collisions with existing filenames in the target dir are resolved
 * by appending `-1`, `-2`, ... like `createTaskFile`. Preserves the file
 * content exactly (frontmatter id/created/body).
 *
 * Returns the task read back from its NEW location (so `frontmatter.filename`
 * reflects any collision suffix), or `null` when the params are invalid or
 * the source file does not exist.
 *
 * This function does NOT validate that the target lane already exists — that
 * is the route's job (`existsLane`); it is the raw file move.
 */
export async function moveTaskBetweenLanes(
    workspace: string,
    srcLane: string,
    targetLane: string,
    filename: string,
): Promise<{ rawMarkdown: string; frontmatter: TaskInfo } | null> {
    for (const seg of [workspace, srcLane, targetLane, filename]) {
        if (!seg || hasUnsafeSegment(seg)) {
            return null;
        }
    }

    const srcPath = resolve(TASKS_ROOT, workspace, srcLane, `${filename}.md`);
    let raw: string;
    try {
        raw = await readFile(srcPath, "utf8");
    } catch {
        return null;
    }

    const targetDir = resolve(TASKS_ROOT, workspace, targetLane);
    await mkdir(targetDir, { recursive: true });

    let baseName = filename;
    let destPath = resolve(targetDir, `${baseName}.md`);
    let i = 1;
    try {
        while (await stat(destPath)) {
            baseName = `${filename}-${i}`;
            destPath = resolve(targetDir, `${baseName}.md`);
            i++;
        }
    } catch {
        // File doesn't exist — that's what we want.
    }

    await rename(srcPath, destPath);

    return getTaskFile(workspace, targetLane, baseName);
}