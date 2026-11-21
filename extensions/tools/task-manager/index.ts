/**
 * Task Manager Extension for Pi
 * 
 * Manages tasks via Markdown files with native Node.js file operations.
 * Cross-platform: works on Windows, macOS, and Linux.
 * - Blocks direct access to ~/.pi/tasks/ folder
 * - Provides CRUD tools and commands for task management
 * - Multiple tasks may be Active at the same time
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolve, basename, dirname, resolve as resolvePath } from "node:path";
import { readdir, readFile, writeFile, appendFile, mkdir, rename, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { exec, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { promisify } from "node:util";
import { Text } from "@earendil-works/pi-tui";
import {
    TASKS_ROOT,
    FOLDERS,
    getWorkspaceName,
    parseFrontmatter,
    normalizeTaskName,
    listTasksInLane,
    getAllTasksForWorkspace,
    dropClosedLane,
    validateTasksParams,
    emptyResultHint,
    TasksParamsSchema,
} from "./src/tasks/index.ts";
import type { TaskInfo, Lane, TasksParams } from "./src/tasks/index.ts";

const VERSION = "0.2.0";
const execAsync = promisify(exec);

/**
 * Module-scoped handle for the dashboard HTTP server. Set on first
 * `/couralabs:task-dashboard` invocation via `startDashboardServer()`, consulted on
 * subsequent invocations for idempotency. Per spec §6.4 there is no
 * `session_shutdown` handler that stops it — the server intentionally
 * outlives the session. The server module is imported lazily so its
 * markdown dependencies are only installed on first dashboard use.
 */
let dashboardServerHandle: {
    url: string;
    port: number;
    server: import("node:http").Server;
} | null = null;

/**
 * Cross-platform helper for opening a URL in the OS default browser.
 * Mirrors the pattern used by `openTaskFileInEditor` below.
 *
 * Escapes hatch: `BROWSER=none` skips the spawn entirely. The URL is
 * still surfaced via `ctx.ui.notify` in the caller.
 */
function openBrowser(url: string): void {
    if (process.env.BROWSER === "none") return;
    const cmd = process.platform === "darwin" ? "open"
              : process.platform === "win32"  ? "start"
              : "xdg-open";
    execAsync(`${cmd} "${url}"`).catch(() => {
        // Swallow: the URL was already surfaced via ctx.ui.notify.
    });
}

const EXTENSION_ROOT = import.meta.dirname;

let installInFlight: Promise<void> | null = null;

function runNpmInstall(): Promise<void> {
    return new Promise((resolveInstall, rejectInstall) => {
        const child = spawn("npm", ["install", "--omit=dev"], { cwd: EXTENSION_ROOT, stdio: "ignore" });
        child.on("exit", (code) => {
            if (code === 0) resolveInstall();
            else rejectInstall(new Error(`npm install failed with exit code ${code} (cwd: ${EXTENSION_ROOT})`));
        });
        child.on("error", rejectInstall);
    });
}

async function missingDependencies(): Promise<string[]> {
    const manifest = JSON.parse(await readFile(resolvePath(EXTENSION_ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    return Object.keys(manifest.dependencies ?? {}).filter(
        (name) => !existsSync(resolvePath(EXTENSION_ROOT, "node_modules", name, "package.json")),
    );
}

async function ensureDependencies(): Promise<void> {
    if ((await missingDependencies()).length === 0) return;
    installInFlight ??= runNpmInstall().finally(() => { installInFlight = null; });
    await installInFlight;
    const stillMissing = await missingDependencies();
    if (stillMissing.length > 0) throw new Error(`npm install finished but ${stillMissing.join(", ")} is still missing (cwd: ${EXTENSION_ROOT})`);
}

interface DashboardServerModule {
    startDashboardServer(): Promise<{ url: string; port: number; server: import("node:http").Server }>;
    clearShutdownHandler(): void;
}

const DASHBOARD_SERVER_ENTRY = "./src/server/index.ts";

function loadDashboardServer(): Promise<DashboardServerModule> {
    return import(DASHBOARD_SERVER_ENTRY) as Promise<DashboardServerModule>;
}

/**
 * Register message renderer for task entries
 */
function registerTaskRenderer(pi: ExtensionAPI): void {
    pi.registerMessageRenderer("task", (message, options, theme) => {
        const { expanded } = options;
        const taskName = (message.details as { name?: string })?.name || "Task";

        let header = theme.fg("accent", `📋 ${taskName}`);
        let body = message.content;

        if (expanded && message.details) {
            body += "\n" + theme.fg("dim", JSON.stringify(message.details, null, 2));
        }

        return new Text(`${header}\n\n${body}`, 1, 1);
    });
}

// The `tasks` tool parameter schema and its runtime validator live in
// src/tasks/tool-params.ts so the model-facing contract and the enforced
// contract stay in one place (a test asserts they agree).

/**
 * Ensure a directory exists, creating it recursively if needed
 */
async function ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
}

/**
 * Find a task file by UUID across all folders.
 * Returns the full file path and the folder it was found in, or null.
 */
async function findTaskFileByUUID(workspace: string, uuid: string): Promise<{ filePath: string; folder: string } | null> {
    for (const folder of FOLDERS) {
        const dir = resolve(TASKS_ROOT, workspace, folder);
        let files: string[];
        try {
            files = await readdir(dir);
        } catch {
            continue;
        }
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const filePath = resolve(dir, file);
            try {
                const content = await readFile(filePath, "utf8");
                const fm = parseFrontmatter(content);
                if (fm.id === uuid || fm.id.startsWith(uuid)) {
                    return { filePath, folder };
                }
            } catch {
                continue;
            }
        }
    }
    return null;
}



/**
 * Create a new task file. Returns the generated UUID.
 */
async function createTask(workspace: string, title: string, priority: string = "medium", content?: string): Promise<string> {
    const folderPath = resolve(TASKS_ROOT, workspace, "Backlog");
    await ensureDir(folderPath);

    const id = randomUUID();
    const created = new Date().toISOString().slice(0, 10);
    const safeName = title.replace(/[^\w\-]/g, "-").replace(/-+/g, "-");
    let fileName = `${safeName}.md`;
    let filePath = resolve(folderPath, fileName);

    // Handle name collisions
    let i = 1;
    try {
        while (await stat(filePath)) {
            fileName = `${safeName}-${i}.md`;
            filePath = resolve(folderPath, fileName);
            i++;
        }
    } catch {
        // File doesn't exist, which is what we want
    }

    const body = content ? `${content}\n\n` : "";
    const fileContent = `---\nid: ${id}\ntitle: ${title}\ncreated: ${created}\npriority: ${priority}\ntags:\n---\n\n# ${title}\n\n${body}`;
    await writeFile(filePath, fileContent, "utf8");
    return id;
}

/**
 * Move a task to a different folder by UUID.
 * Returns "oldFolder\tnewFolder".
 */
async function moveTask(workspace: string, uuid: string, newFolder: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    const newDir = resolve(TASKS_ROOT, workspace, newFolder);
    await ensureDir(newDir);

    const fileName = basename(found.filePath);
    const newPath = resolve(newDir, fileName);
    await rename(found.filePath, newPath);
    return `${found.folder}\t${newFolder}`;
}

/**
 * Append content to a task by UUID.
 */
async function appendToTask(workspace: string, uuid: string, content?: string, fileSrc?: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    let appendContent = content;
    if (fileSrc) {
        appendContent = await readFile(fileSrc, "utf8");
    }

    if (!appendContent) {
        throw new Error("Either content or file parameter is required");
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const toAppend = `\n----\n${timestamp}\n${appendContent}`;
    await appendFile(found.filePath, toAppend, "utf8");

    return await readFile(found.filePath, "utf8");
}

/**
 * Delete a task by UUID. Returns the folder it was in.
 */
async function deleteTask(workspace: string, uuid: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }
    await unlink(found.filePath);
    return found.folder;
}

/**
 * Rename a task by UUID. Updates the title in frontmatter. Returns the folder.
 */
async function renameTaskFile(workspace: string, uuid: string, newTitle: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    let content = await readFile(found.filePath, "utf8");
    content = content.replace(/^(title:).+/m, `$1 ${newTitle}`);
    await writeFile(found.filePath, content, "utf8");
    return found.folder;
}

/**
 * Submit a task to QA: append a QA note and move to user-qa folder.
 */
async function submitTaskToQa(workspace: string, uuid: string, context: string): Promise<string> {
    const found = await findTaskFileByUUID(workspace, uuid);
    if (!found) {
        throw new Error(`Task with UUID '${uuid}' not found`);
    }

    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    const qaNote = `\n----\n${timestamp}\n## Submitted to QA\n${context}`;
    await appendFile(found.filePath, qaNote, "utf8");

    const newDir = resolve(TASKS_ROOT, workspace, "user-qa");
    await ensureDir(newDir);
    const fileName = basename(found.filePath);
    const newPath = resolve(newDir, fileName);
    await rename(found.filePath, newPath);
    return "Moved to user-qa";
}

/**
 * Find a task by name prefix (fuzzy match)
 */
async function findTask(workspace: string, name: string): Promise<TaskInfo | null> {
    const allLanes = await getAllTasksForWorkspace(workspace);
    const normalizedSearch = normalizeTaskName(name);

    for (const lane of allLanes) {
        for (const task of lane.tasks) {
            const normalizedTitle = normalizeTaskName(task.title);
            if (normalizedTitle.startsWith(normalizedSearch)) {
                return task;
            }
        }
    }

    // Partial match
    for (const lane of allLanes) {
        for (const task of lane.tasks) {
            if (normalizeTaskName(task.title).includes(normalizedSearch)) {
                return task;
            }
        }
    }

    return null;
}

/**
 * Get tasks excluding Closed folder (for /tasks command).
 * Returns Lane[] shaped like getAllTasksForWorkspace, with lane.name === folder.
 */
async function getOpenTasks(workspace: string): Promise<Lane[]> {
    return Promise.all(
        (["Backlog", "Active", "user-qa"] as const).map(async (folder): Promise<Lane> => ({
            name: folder,
            tasks: await listTasksInLane(workspace, folder),
        })),
    );
}

/**
 * Find all tasks matching a name (for disambiguation).
 * Wraps `getAllTasksForWorkspace` from the shared lib.
 */
async function findAllMatchingTasks(workspace: string, name: string): Promise<TaskInfo[]> {
    const allLanes = await getAllTasksForWorkspace(workspace);
    const normalizedSearch = normalizeTaskName(name);
    const matches: TaskInfo[] = [];

    for (const lane of allLanes) {
        for (const task of lane.tasks) {
            const normalizedTitle = normalizeTaskName(task.title);
            if (normalizedTitle.startsWith(normalizedSearch) || normalizedTitle.includes(normalizedSearch)) {
                matches.push(task);
            }
        }
    }

    return matches;
}

/**
 * Find exact match (normalized) or return null.
 */
async function findExactMatchTask(workspace: string, name: string): Promise<TaskInfo | null> {
    const matches = await findAllMatchingTasks(workspace, name);
    const normalizedSearch = normalizeTaskName(name);
    return matches.find(m => normalizeTaskName(m.title) === normalizedSearch) || null;
}

/**
 * Get full task file content by scanning the directory.
 * Used by /tasks and /task-work to fetch a task's markdown given its filename.
 */
async function getTaskContent(workspace: string, name: string): Promise<string | null> {
    for (const folder of FOLDERS) {
        const folderPath = resolve(TASKS_ROOT, workspace, folder);
        let files: string[];
        try {
            files = await readdir(folderPath);
        } catch {
            continue;
        }

        const normalizedName = normalizeTaskName(name);
        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            const fileNameLower = file.toLowerCase();
            if (fileNameLower.startsWith(normalizedName) || fileNameLower.includes(normalizedName)) {
                const filePath = resolve(folderPath, file);
                try {
                    return await readFile(filePath, "utf8");
                } catch {
                    continue;
                }
            }
        }
    }
    return null;
}

export default function registerTaskManager(pi: ExtensionAPI): void {
    markExtensionLoaded("task-manager");

    // Batch mode state for /task-work all
    let batchMode = false;
    let batchTasks: TaskInfo[] = [];
    let batchIndex = 0;

    // Register task message renderer
    registerTaskRenderer(pi);

    // Session start: notify about active tasks
    pi.on("session_start", async (_event, ctx) => {
        if (!ctx.hasUI || isChildSession(ctx.sessionManager.getSessionId())) return;
        const workspace = getWorkspaceName(ctx.cwd);
        const activeTasks = (await listTasksInLane(workspace, "Active"));

        if (activeTasks.length === 0) {
            // No active tasks - check backlog
            const backlogTasks = (await listTasksInLane(workspace, "Backlog"));
            if (backlogTasks.length > 0) {
                ctx.ui.notify(`You have ${backlogTasks.length} task(s) in Backlog. Use /tasks to view.`, "info");
            }
        } else {
            const titles = activeTasks.map(t => `"${t.title}"`).join(", ");
            ctx.ui.notify(`${activeTasks.length} active task(s): ${titles}`, "info");
        }
    });

    // Permission gate: block writes to tasks folder, allow reads
    pi.on("tool_call", async (event, ctx) => {
        const toolName = event.toolName;

        // Only block write/edit/bash to tasks folder, allow read
        if (["write", "edit", "bash"].includes(toolName)) {
            let path: string | undefined;

            if (toolName === "bash" && "command" in event.input) {
                path = event.input.command as string | undefined;
            } else if ("path" in event.input) {
                path = event.input.path as string | undefined;
            }

            if (path) {
                const resolved = resolve(ctx.cwd, path);
                if (resolved.startsWith(TASKS_ROOT) || resolved.replace(/\\/g, "/").startsWith(TASKS_ROOT.replace(/\\/g, "/"))) {
                    const ok = await ctx.ui.confirm(
                        "Task Access",
                        `Block attempt to access tasks folder directly. Use task tools instead?`
                    );
                    if (!ok) return;
                    ctx.ui.notify("Use task tools (/tasks, /task-active) for task management", "info");
                    return { block: true, reason: "Tasks must be managed via task tools" };
                }
            }
        }
    });

    // Register task tool
    pi.registerTool({
        name: "tasks",
        label: "Tasks",
        description: "Manage tasks. Tasks are NOT accessible as files - always use this tool. `action` selects the operation; every other parameter belongs to specific actions and is REJECTED (with a corrected signature) if it does not apply. Signatures: list(includeClosed?) | create(title, priority?, content?) | get(uuid) | append(uuid, content | file) | move(uuid, folder: Backlog|Active|Closed) | rename(uuid, newTitle) | delete(uuid) | search(name) | submit-qa(uuid?, message?). To record progress on a task: create it once, then append with its uuid.",
        promptSnippet: "Manage project tasks via task tools",
        promptGuidelines: ["Use task tools when asked to work with tasks, list tasks, or assign work"],
        parameters: TasksParamsSchema as any,

        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            // Validate before dispatching. Pi does not check tool arguments
            // against `parameters`, so without this an action would silently
            // ignore parameters meant for a different action — which reads to
            // the model as "the tool is broken". The message returned here
            // names the action that fits and prints its signature.
            const problem = validateTasksParams(params);
            if (problem) {
                return {
                    content: [{ type: "text", text: problem.message }],
                    details: {
                        error: problem.kind,
                        action: problem.action,
                        unexpected: problem.unexpected,
                        suggestions: problem.suggestions,
                    },
                };
            }
            const p = params as TasksParams;
            const workspace = getWorkspaceName(ctx.cwd);
            try {
                switch (p.action) {
                    case "create": {
                        const priority = p.priority || "medium";
                        const id = await createTask(workspace, p.title!, priority, p.content);
                        return {
                            content: [{ type: "text", text: `[create] Created task "${p.title}" [${priority}] (${id.substring(0, 8)})` }],
                            details: { action: "create", id, title: p.title, priority, workspace }
                        };
                    }

                    case "list": {
                        const allTasks = await getAllTasksForWorkspace(workspace);
                        const lanes = p.includeClosed ? allTasks : dropClosedLane(allTasks);
                        let output = "";
                        for (const result of lanes) {
                            if (result.tasks.length > 0) {
                                output += `\n## ${result.name} (${result.tasks.length})\n`;
                                for (const task of result.tasks) {
                                    output += `- **${task.title}** [${task.priority}] ${task.uuid.substring(0, 8)}\n`;
                                }
                            }
                        }
                        return {
                            content: [{ type: "text", text: output ? `[list]${output}` : `[list] No tasks found. ${emptyResultHint("list")}` }],
                            details: { action: "list", tasks: lanes, includeClosed: !!p.includeClosed },
                        };
                    }

                    case "move": {
                        var taskId = p.uuid || p.id;
                        const result = await moveTask(workspace, taskId!, p.folder!);
                        return {
                            content: [{ type: "text", text: `[move] Moved task to ${p.folder}` }],
                            details: { action: "move", result }
                        };
                    }

                    case "append": {
                        var taskId = p.uuid || p.id;
                        await appendToTask(workspace, taskId!, p.content, p.file);
                        return {
                            content: [{ type: "text", text: `[append] Added content to task (${taskId!.substring(0, 8)})` }],
                            details: { action: "append", uuid: taskId }
                        };
                    }

                    case "delete": {
                        var taskId = p.uuid || p.id;
                        const folder = await deleteTask(workspace, taskId!);
                        return {
                            content: [{ type: "text", text: `[delete] Deleted task from ${folder}` }],
                            details: { action: "delete", folder }
                        };
                    }

                    case "rename": {
                        var taskId = p.uuid || p.id;
                        const folder = await renameTaskFile(workspace, taskId!, p.newTitle!);
                        return {
                            content: [{ type: "text", text: `[rename] Renamed to "${p.newTitle}" (${folder})` }],
                            details: { action: "rename", folder }
                        };
                    }

                    case "search": {
                        const task = await findTask(workspace, p.name!);
                        if (!task) {
                            return {
                                content: [{ type: "text", text: `[search] No task found matching "${p.name}". ${emptyResultHint("search")}` }],
                                details: { action: "search", found: false, name: p.name }
                            };
                        }
                        return {
                            content: [{ type: "text", text: `[search] Found: **${task.title}** in ${task.folder} [${task.priority}] (${task.uuid.substring(0, 8)})` }],
                            details: { action: "search", found: true, task }
                        };
                    }

                    case "get": {
                        const taskId = p.uuid || p.id;
                        // Find task by UUID and return its content
                        const task = await getTaskByUUID(workspace, taskId!);
                        if (!task) {
                            return {
                                content: [{ type: "text", text: `[get] Task with UUID ${taskId!.substring(0, 8)} not found. ${emptyResultHint("get")}` }],
                                details: { action: "get", found: false }
                            };
                        }
                        const content = await getTaskContent(workspace, task.filename);
                        return {
                            content: [{
                                type: "text",
                                text: content
                                    ? `[get] ${task.title} (${task.folder})\n\n${content}`
                                    : `[get] Could not read content of "${task.title}"`,
                            }],
                            details: { action: "get", found: true, task }
                        };
                    }

                    case "submit-qa": {
                        const activeTasks = await listTasksInLane(workspace, "Active");
                        // Honour an explicit uuid/id: previously this branch
                        // told the caller to "specify which task via uuid" and
                        // then ignored the uuid it was given.
                        const requested = p.uuid || p.id;
                        if (requested) {
                            const target = requested.length >= 8
                                ? activeTasks.find((t) => t.uuid.startsWith(requested))
                                : undefined;
                            if (!target) {
                                const known = activeTasks.map((t) => `"${t.title}" (${t.uuid.substring(0, 8)})`).join(", ") || "none";
                                return {
                                    content: [{
                                        type: "text",
                                        text: `[submit-qa] Task ${requested.substring(0, 8)} is not in the Active folder. Active tasks: ${known}.\n` +
                                            `Move it first with tasks(action="move", uuid="<uuid>", folder="Active").`,
                                    }],
                                    details: { action: "submit-qa", found: false, requested },
                                };
                            }
                            const targetResult = await submitTaskToQa(workspace, target.uuid, p.message || "");
                            return {
                                content: [{ type: "text", text: `[submit-qa] Submitted "${target.title}" to QA${p.message ? `: ${p.message}` : ""}` }],
                                details: { action: "submit-qa", uuid: target.uuid, result: targetResult }
                            };
                        }
                        if (activeTasks.length === 0) {
                            return {
                                content: [{ type: "text", text: "[submit-qa] No active task to submit to QA. Move one in with tasks(action=\"move\", uuid=\"<uuid>\", folder=\"Active\")." }],
                                details: { action: "submit-qa", error: "no active task" }
                            };
                        }
                        if (activeTasks.length > 1) {
                            const titles = activeTasks.map(t => `"${t.title}" (${t.uuid.substring(0, 8)})`).join(", ");
                            return {
                                content: [{ type: "text", text: `[submit-qa] Multiple active tasks: ${titles}. Specify one with tasks(action="submit-qa", uuid="<uuid>").` }],
                                details: { action: "submit-qa", error: "multiple active tasks" }
                            };
                        }
                        const taskUUID = activeTasks[0].uuid;
                        const result = await submitTaskToQa(workspace, taskUUID, p.message || "");
                        return {
                            content: [{ type: "text", text: `[submit-qa] Submitted "${activeTasks[0].title}" to QA${p.message ? `: ${p.message}` : ""}` }],
                            details: { action: "submit-qa", uuid: taskUUID, result }
                        };
                    }

                    default:
                        // Unreachable: validateTasksParams rejects unknown
                        // actions before the switch. Kept as a safety net.
                        return {
                            content: [{ type: "text", text: `Unknown action: ${p.action}` }],
                            details: { error: "unknown action" }
                        };
                }
            } catch (error) {
                return {
                    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                    details: { error: String(error) }
                };
            }
        },
    });

    // Register /tasks command - list all tasks
    pi.registerCommand("tasks", {
        description: "List all tasks by folder",
        async handler(_args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!ctx.hasUI) {
                const openTasks = await getOpenTasks(workspace);
                let output = "Tasks:\n";
                for (const result of openTasks) {
                    if (result.tasks.length > 0) {
                        output += `\n${result.name}:\n`;
                        for (const task of result.tasks) {
                            output += `  - ${task.title} [${task.priority}]\n`;
                        }
                    }
                }
                ctx.ui.notify(output || "No tasks", "info");
                return;
            }


            // Interactive picker
            const openTasks = await getOpenTasks(workspace);
            const items: { value: string; label: string }[] = [];

            for (const result of openTasks) {
                for (const task of result.tasks) {
                    items.push({
                        value: `${task.filename}`,
                        label: `[${result.name}] ${task.title} (${task.uuid.substring(0, 8)})`
                    });
                }
            }

            if (items.length === 0) {
                ctx.ui.notify("No tasks found", "info");
                return;
            }

            const choice = await ctx.ui.select("Tasks", items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            // Find selected task and output its content
            const selected = items.find(i => i.label === choice);
            if (selected) {
                const taskFilename = selected.value;
                const content = await getTaskContent(workspace, taskFilename);
                if (content) {
                    // Display the task content as a notification
                    ctx.ui.notify(`Task: ${taskFilename}\n\n${content}`, "info");
                } else {
                    ctx.ui.notify(`Could not read task "${taskFilename}"`, "error");
                }
            }
        },
    });

    // Register /task-active command - assign a task to Active
    pi.registerCommand("task-active", {
        description: "List non-closed tasks, or assign a task to Active (use /task-active <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);

            if (!args) {
                // No args - list all non-closed tasks grouped by lane
                if (!ctx.hasUI) {
                    const openTasks = await getOpenTasks(workspace);
                    let output = "Tasks:\n";
                    for (const result of openTasks) {
                        if (result.tasks.length > 0) {
                            output += `\n${result.name}:\n`;
                            for (const task of result.tasks) {
                                output += `  - ${task.title} [${task.priority}]\n`;
                            }
                        }
                    }
                    ctx.ui.notify(output || "No tasks", "info");
                    return;
                }

                const openTasks = await getOpenTasks(workspace);
                const items: { value: string; label: string }[] = [];

                for (const result of openTasks) {
                    for (const task of result.tasks) {
                        items.push({
                            value: task.uuid,
                            label: `[${result.name}] ${task.title} (${task.uuid.substring(0, 8)})`
                        });
                    }
                }

                if (items.length === 0) {
                    ctx.ui.notify("No tasks found. Use /task-new to create one.", "info");
                    return;
                }

                const choice = await ctx.ui.select("Select a task to activate:", items.map(i => i.label));
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }

                const selected = items.find((_, i) => items[i].label === choice);
                if (selected) {
                    const taskUUID = selected.value;
                    const task = (await getAllTasksForWorkspace(workspace))
                        .flatMap(lane => lane.tasks)
                        .find(t => t.uuid === taskUUID);

                    if (!task) {
                        ctx.ui.notify(`Could not find task with UUID ${taskUUID.substring(0, 8)}`, "error");
                        return;
                    }

                    await moveTask(workspace, taskUUID, "Active");
                    ctx.ui.notify(`Now active: "${task.title}"`, "info");
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatchingTasks(workspace, args);
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - select directly
                const title = exactMatch.title;
                const taskUUID = exactMatch.uuid;

                await moveTask(workspace, taskUUID, "Active");
                ctx.ui.notify(`Now active: "${title}"`, "info");
                return;
            }

            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}". Use /task-new to create one.`, "error");
                return;
            }

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const taskUUID = selected.value;
                const task = matches.find(m => m.uuid === taskUUID);

                await moveTask(workspace, taskUUID, "Active");
                ctx.ui.notify(`Now active: "${task?.title}"`, "info");
            }
        },
    });

    // Helper to find task file path by title or UUID
    async function findTaskPath(workspace: string, nameOrUUID: string): Promise<string | null> {
        // First try to find by UUID using shared helper
        const found = await findTaskFileByUUID(workspace, nameOrUUID);
        if (found) return found.filePath;

        // Fallback: try to find by normalized title in filename
        const normalizedName = normalizeTaskName(nameOrUUID);
        for (const folder of FOLDERS) {
            const folderPath = resolve(TASKS_ROOT, workspace, folder);
            let files: string[];
            try {
                files = await readdir(folderPath);
            } catch {
                continue;
            }

            for (const file of files) {
                if (!file.endsWith(".md")) continue;
                const fileNameLower = file.toLowerCase();
                if (fileNameLower.startsWith(normalizedName) || fileNameLower.includes(normalizedName)) {
                    return resolve(folderPath, file);
                }
            }
        }
        return null;
    }

    // Get task info by UUID or short UUID
    async function getTaskByUUID(workspace: string, uuid: string): Promise<TaskInfo | null> {
        if (uuid.length < 8) return null; 

        const allTasks = await getAllTasksForWorkspace(workspace);
        for (const result of allTasks) {
            const task = result.tasks.find(t => t.uuid.startsWith(uuid));
            if (task) return task;
        }
        return null;
    }

    async function openTaskFileInEditor(filePath: string, title: string, ctx: any) {
        try {
            const platform = process.platform;
            const cmd = platform === "win32" ? `start "" "${filePath}"`
                : platform === "darwin" ? `open "${filePath}"`
                : `xdg-open "${filePath}"`;
            await execAsync(cmd);
            ctx.ui.notify(`Opened "${title}" in editor`, "info");
        } catch (error) {
            ctx.ui.notify(`Error opening task: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
    }

    // Register /task-open command - open a task in the default editor
    pi.registerCommand("task-open", {
        description: "Open a task file in the default editor (use /task-open <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);

            if (!args) {
                // No args provided - show picker with all tasks
                const allTasks = await getAllTasksForWorkspace(workspace);
                const items: { value: string; label: string }[] = [];

                for (const result of allTasks) {
                    for (const task of result.tasks) {
                        items.push({
                            value: task.uuid,
                            label: `[${result.name}] ${task.title} (${task.uuid.substring(0, 8)})`
                        });
                    }
                }

                if (items.length === 0) {
                    ctx.ui.notify("No tasks found", "info");
                    return;
                }

                const choice = await ctx.ui.select("Select a task to open:", items.map(i => i.label));
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }

                const selected = items.find((_, i) => items[i].label === choice);
                if (selected) {
                    const task = await getTaskByUUID(workspace, selected.value);
                    if (task) {
                        const filePath = await findTaskPath(workspace, task.uuid);
                        if (filePath) {
                            await openTaskFileInEditor(filePath, task.title, ctx);
                        } else {
                            ctx.ui.notify(`Could not find task file for "${task.title}"`, "error");
                        }
                    } else {
                        ctx.ui.notify(`Could not find task with UUID ${selected.value.substring(0, 8)}`, "error");
                    }
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatchingTasks(workspace, args);
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - open directly
                const filePath = await findTaskPath(workspace, exactMatch.uuid);
                if (filePath) {
                    await openTaskFileInEditor(filePath, exactMatch.title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${exactMatch.title}"`, "error");
                }
                return;
            }

            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                const task = await getTaskByUUID(workspace, selected.value);
                if (task) {
                    const filePath = await findTaskPath(workspace, task.uuid);
                    if (filePath) {
                        await openTaskFileInEditor(filePath, task.title, ctx);
                    } else {
                        ctx.ui.notify(`Could not find task file`, "error");
                    }
                } else {
                    ctx.ui.notify(`Could not find task with UUID ${selected.value.substring(0, 8)}`, "error");
                }
            }
        },
    });

    // Register /task-create command - create a new task (alias for /task-new)
    pi.registerCommand("task-create", {
        description: "Create a new task (use /task-create [-o] <title> [--priority=high] [--content='...'])",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-create [-o] <title> [--priority=low|medium|high|critical] [--content='...']", "info");
                return;
            }

            // Parse -o flag (must be at start, standalone)
            let openTask = false;
            let remaining = args;
            if (args.match(/^-o\s/)) {
                openTask = true;
                remaining = args.replace(/^-o\s/, "");
            }

            // Parse priority from args if present
            let title = remaining;
            let priority = "medium";
            const priorityMatch = remaining.match(/--priority=(\w+)/);
            if (priorityMatch) {
                priority = priorityMatch[1];
                title = remaining.replace(/--priority=\w+\s*/, "");
            }

            // Parse content from args if present
            let content = "";
            const contentMatch = title.match(/--content='([^']*)'/);
            if (contentMatch) {
                content = contentMatch[1];
                title = title.replace(/--content='[^']*'\s*/, "");
            }

            const id = await createTask(workspace, title, priority, content);
            ctx.ui.notify(`Created task "${title}" (${id.substring(0, 8)})`, "info");

            // Open task after creation if -o flag was set
            if (openTask) {
                const filePath = await findTaskPath(workspace, title);
                if (filePath) {
                    await openTaskFileInEditor(filePath, title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${title}"`, "error");
                }
            }
        },
    });

    // Register /task-new command - create a new task (kept for backward compatibility)
    pi.registerCommand("task-new", {
        description: "Create a new task (use /task-new [-o] <title> [--priority=high]) - Alias: /task-create",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);
            if (!args) {
                ctx.ui.notify("Usage: /task-new [-o] <title> [--priority=low|medium|high|critical]", "info");
                return;
            }

            // Parse -o flag (must be at start, standalone)
            let openTask = false;
            let remaining = args;
            if (args.match(/^-o\s/)) {
                openTask = true;
                remaining = args.replace(/^-o\s/, "");
            }

            // Parse priority from args if present
            let title = remaining;
            let priority = "medium";
            const priorityMatch = remaining.match(/--priority=(\w+)/);
            if (priorityMatch) {
                priority = priorityMatch[1];
                title = remaining.replace(/--priority=\w+\s*/, "");
            }

            const id = await createTask(workspace, title, priority);
            ctx.ui.notify(`Created task "${title}" (${id.substring(0, 8)})`, "info");

            // Open task after creation if -o flag was set
            if (openTask) {
                const filePath = await findTaskPath(workspace, title);
                if (filePath) {
                    await openTaskFileInEditor(filePath, title, ctx);
                } else {
                    ctx.ui.notify(`Could not find task file for "${title}"`, "error");
                }
            }
        },
    });


    // Register /task-work command - assign task and instruct agent to work on it
    pi.registerCommand("task-work", {
        description: "Assign a task to Active and instruct agent to work on it (use /task-work <name> or /task-work all)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);

            // Check for "all" argument
            if (args === "all") { // TODO: fix command
                // const backlogTasks = await listTasksInLane(workspace, "Backlog");

                // if (backlogTasks.length === 0) {
                //     ctx.ui.notify("No tasks in Backlog", "info");
                //     return;
                // }

                // const confirmed = await ctx.ui.confirm(
                //     "Batch Mode",
                //     `Work on ${backlogTasks.length} task(s) from Backlog?`
                // );

                // if (!confirmed) {
                //     ctx.ui.notify("Cancelled", "info");
                //     return;
                // }

                // // Set batch state and start processing
                // batchMode = true;
                // batchTasks = backlogTasks;
                // batchIndex = 0;

                // await processNextBatchTask(workspace, ctx);
                // return;
            }

            // If no args, check active tasks or show all tasks
            if (!args) {
                const activeTasks = await listTasksInLane(workspace, "Active");
                if (activeTasks.length === 0) {
                    // No active task - show all tasks for selection
                    const openTasks = await getOpenTasks(workspace);
                    const items: { value: string; label: string }[] = [];

                    for (const result of openTasks) {
                        for (const task of result.tasks) {
                            items.push({
                                value: task.uuid,
                                label: `[${result.name}] ${task.title} (${task.uuid.substring(0, 8)})`
                            });
                        }
                    }

                    if (items.length === 0) {
                        ctx.ui.notify("No tasks found", "info");
                        return;
                    }

                    const choice = await ctx.ui.select("Select a task to work on:", items.map(i => i.label));
                    if (!choice) {
                        ctx.ui.notify("Cancelled", "info");
                        return;
                    }

                    const selected = items.find((_, i) => items[i].label === choice);
                    if (selected) {
                        await assignTaskToAgent(workspace, selected.value, ctx);
                    }
                    return;
                }
                if (activeTasks.length === 1) {
                    // Use the single active task
                    await assignTaskToAgent(workspace, activeTasks[0].uuid, ctx);
                    return;
                }
                ctx.ui.notify(`Multiple active tasks. Use /task-work <task-name>`, "info");
                return;
            }

            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                await assignTaskToAgent(workspace, exactMatch.uuid, ctx);
                return;
            }

            const matches = await findAllMatchingTasks(workspace, args);
            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }

            const items: { value: string; label: string }[] = matches.map(task => ({
                value: task.uuid,
                label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
            }));

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                await assignTaskToAgent(workspace, selected.value, ctx);
            }
        }
    });

    // Process next task in batch mode
    async function processNextBatchTask(workspace: string, ctx: any) {
        if (batchIndex >= batchTasks.length) {
            // Batch complete
            const count = batchTasks.length;
            batchMode = false;
            batchTasks = [];
            batchIndex = 0;
            ctx.ui.notify(`Batch complete: ${count} tasks processed`, "info");
            return;
        }

        const currentTask = batchTasks[batchIndex];

        // Move current batch task to Active
        await moveTask(workspace, currentTask.uuid, "Active");

        // Get task content
        const content = await getTaskContent(workspace, currentTask.filename);
        if (content) {
            const taskNum = batchIndex + 1;
            const totalTasks = batchTasks.length;

            const messageContent = `Continuing Batch: Task ${taskNum} of ${totalTasks}

Work on the following task:

${content}

---

**Instructions:**
1. Read and understand the task above
2. Implement the changes
3. Commit your changes with a meaningful message
4. Use \`/submit-qa <brief description of changes>\` to submit to QA
5. This message IS the continuation signal - after submitting to QA, the next task will arrive automatically. Do NOT wait for any other input.

---`;

            // Use sendMessage with triggerTurn to force a new agent turn
            pi.sendMessage({
                customType: "batch-continue",
                content: messageContent,
                display: true,
            }, {
                triggerTurn: true,
            });
        }

        ctx.ui.notify(`Now working on: "${currentTask.title}" (${batchIndex + 1}/${batchTasks.length})`, "info");
    }

    // Helper to assign task and send to agent (takes UUID)
    async function assignTaskToAgent(workspace: string, uuid: string, ctx: any) {
        // Find task by UUID
        const allTasks = await getAllTasksForWorkspace(workspace);
        let task: TaskInfo | undefined;
        for (const result of allTasks) {
            task = result.tasks.find(t => t.uuid === uuid);
            if (task) break;
        }

        if (!task) {
            ctx.ui.notify(`Task with UUID ${uuid.substring(0, 8)} not found`, "error");
            return;
        }

        await moveTask(workspace, uuid, "Active");

        const content = await getTaskContent(workspace, task.filename);
        if (content) {
            // Send task content with triggerTurn to start the agent
            const steerContent = `Work on the following task:

${content}

---

## Workflow
1. Read and understand the task above
2. Implement the changes
3. Commit your changes with a meaningful message
4. Use \`/submit-qa <brief description of changes>\` to submit to QA

---`;
            pi.sendMessage({
                customType: "task-work",
                content: steerContent,
                display: true,
            }, {
                triggerTurn: true,
            });
        }

        ctx.ui.notify(`Now working on: "${task.title}"`, "info");
    }

    // Register /submit-qa command - submit active task to QA (handles batch mode)
    pi.registerCommand("submit-qa", {
        description: "Submit active task to QA (use /submit-qa <message>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);

            const activeTasks = await listTasksInLane(workspace, "Active");
            if (activeTasks.length === 0) {
                ctx.ui.notify("No active task to submit to QA", "error");
                return;
            }

            let selectedTask = activeTasks[0];
            if (activeTasks.length > 1) {
                const items = activeTasks.map(t => `[Active] ${t.title} (${t.uuid.substring(0, 8)})`);
                const choice = await ctx.ui.select("Multiple active tasks. Select one to submit to QA:", items);
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }
                const idx = items.indexOf(choice);
                if (idx < 0) {
                    ctx.ui.notify("Invalid selection", "error");
                    return;
                }
                selectedTask = activeTasks[idx];
            }

            const taskUUID = selectedTask.uuid;
            const taskTitle = selectedTask.title;

            // Move to user-qa folder
            await moveTask(workspace, taskUUID, "user-qa");

            // Append QA submission note
            const qaNote = args
                ? `\n## QA Submission\n${args}\n`
                : `\n## QA Submission\nSubmitted to QA.\n`;
            await appendToTask(workspace, taskUUID, qaNote);

            ctx.ui.notify(`Submitted "${taskTitle}" to QA`, "info");

            // If in batch mode, process next task
            if (batchMode) {
                batchIndex++;
                await processNextBatchTask(workspace, ctx);
            }
        }
    });

    // Register /task-complete command - mark task as completed
    pi.registerCommand("task-complete", {
        description: "Mark a task as complete (use /task-complete <name>)",
        async handler(args, ctx) {
            const workspace = getWorkspaceName(ctx.cwd);

            // If no args, list all non-closed tasks for selection
            if (!args) {
                const openTasks = await getOpenTasks(workspace);
                const items: { value: string; label: string }[] = [];

                for (const result of openTasks) {
                    for (const task of result.tasks) {
                        items.push({
                            value: task.uuid,
                            label: `[${result.name}] ${task.title} (${task.uuid.substring(0, 8)})`
                        });
                    }
                }

                if (items.length === 0) {
                    ctx.ui.notify("No tasks found", "info");
                    return;
                }

                const choice = await ctx.ui.select("Select a task to complete:", items.map(i => i.label));
                if (!choice) {
                    ctx.ui.notify("Cancelled", "info");
                    return;
                }

                const selected = items.find((_, i) => items[i].label === choice);
                if (selected) {
                    await completeTask(workspace, selected.value, ctx);
                }
                return;
            }

            // Find tasks matching the input
            const matches = await findAllMatchingTasks(workspace, args);

            // Check for exact match
            const exactMatch = await findExactMatchTask(workspace, args);

            if (exactMatch) {
                // Exact match found - process directly
                await completeTask(workspace, exactMatch.uuid, ctx);
                return;
            }

            if (matches.length === 0) {
                ctx.ui.notify(`No task found matching "${args}"`, "error");
                return;
            }

            // No exact match - show disambiguation list with UUIDs
            const items: { value: string; label: string }[] = [];
            for (const task of matches) {
                items.push({
                    value: task.uuid,
                    label: `[${task.folder}] ${task.title} (${task.uuid.substring(0, 8)})`
                });
            }

            const choice = await ctx.ui.select(`${matches.length} tasks matching "${args}":`, items.map(i => i.label));
            if (!choice) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }

            const selected = items.find((_, i) => items[i].label === choice);
            if (selected) {
                await completeTask(workspace, selected.value, ctx);
            }
        },
    });

    // Helper to complete a task (takes UUID)
    async function completeTask(workspace: string, uuid: string, ctx: any) {
        // Find task by UUID
        const allTasks = await getAllTasksForWorkspace(workspace);
        let task: TaskInfo | undefined;
        for (const result of allTasks) {
            task = result.tasks.find(t => t.uuid === uuid);
            if (task) break;
        }

        if (!task) {
            ctx.ui.notify(`Task with UUID ${uuid.substring(0, 8)} not found`, "error");
            return;
        }

        const title = task.title;

        // Move to Closed folder
        await moveTask(workspace, uuid, "Closed");

        // Append completion note
        const qaNote = `\n## Completed\nTask marked as complete.`;
        await appendToTask(workspace, uuid, qaNote);

        ctx.ui.notify(`Moved "${title}" to Closed`, "info");
    }

    // Register /couralabs:task-dashboard command - open the task dashboard in the browser
    // The dashboard opens pre-selected to the workspace matching pi's cwd; if no
    // such workspace exists on disk, it opens with "All projects".
    pi.registerCommand("couralabs:task-dashboard", {
        description: "Open the task dashboard in your browser (http://127.0.0.1:7254 by default). Read-only view of tasks across all projects.",
        async handler(_args, ctx) {
            // Pre-select the workspace matching pi's current working directory. The
            // frontend reads `?workspace=` and seeds the dropdown if the value is
            // non-empty and only contains [A-Za-z0-9_-]. `getWorkspaceName` already
            // strips unsafe characters and dashes from the cwd, but we re-validate
            // defensively so a hand-crafted ctx.cwd can't smuggle separators. If the
            // derived id is empty/unsafe, fall back to the plain URL.
            const cwdWorkspace = getWorkspaceName(ctx.cwd);
            const isSafeWsId = /^[A-Za-z0-9_-]+$/.test(cwdWorkspace);
            const withInitialWorkspace = (baseUrl: string) =>
                isSafeWsId ? `${baseUrl}?workspace=${encodeURIComponent(cwdWorkspace)}` : baseUrl;

            let dashboardServer: DashboardServerModule;
            try {
                await ensureDependencies();
                dashboardServer = await loadDashboardServer();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`Dashboard setup failed: ${message}`, "error");
                return;
            }
            const { startDashboardServer, clearShutdownHandler } = dashboardServer;

            // Idempotency: reuse the running server if we already started one
            // in this session. Per spec §6.3 the handle is module-scoped.
            if (dashboardServerHandle && dashboardServerHandle.server.listening) {
                openBrowser(withInitialWorkspace(dashboardServerHandle.url));
                ctx.ui.notify(`Dashboard: ${dashboardServerHandle.url}`, "info");
                return;
            }

            let handle: { url: string; port: number; server: import("node:http").Server };
            try {
                handle = await startDashboardServer();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (/already in use/i.test(message)) {
                    const port = process.env.TASK_DASHBOARD_PORT ?? "7254";
                    ctx.ui.notify(
                        `Dashboard port ${port} is in use. Set TASK_DASHBOARD_PORT to a free port and stop the conflicting process, then try again.`,
                        "error",
                    );
                } else {
                    ctx.ui.notify(message, "error");
                }
                return;
            }

            dashboardServerHandle = handle;
            // If the user kills the dashboard via its Kill button (which
            // calls `POST /api/shutdown`), the server fires `'close'`.
            // Clear our module-scoped handle so a subsequent
            // `/couralabs:task-dashboard` invocation starts a fresh server instead of
            // trying to reuse a dead one.
            handle.server.once("close", () => {
                if (dashboardServerHandle && dashboardServerHandle.server === handle.server) {
                    dashboardServerHandle = null;
                    clearShutdownHandler();
                }
            });
            openBrowser(withInitialWorkspace(handle.url));
            ctx.ui.notify(`Dashboard: ${handle.url}`, "info");
        },
    });
}