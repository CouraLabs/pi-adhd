import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `vi.hoisted` runs the callback before any module-level `vi.mock` (which
// is itself hoisted to the top of the file), and before the top-level
// `import { vi } from "vitest"` completes — so we have to bring our own
// Node imports into the hoisted block.
const { tmpRoot } = vi.hoisted(() => {
    const { mkdtempSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    return {
        tmpRoot: mkdtempSync(join(tmpdir(), "task-manager-count-")),
    };
});

vi.mock("./paths.ts", () => ({ TASKS_ROOT: tmpRoot }));

// Import after the mock so the module picks up our temp root.
import { listWorkspaces, listLanes, listAllTasksGroupedByLane, dropClosedLane, type Lane } from "./index.ts";

/** Build `<root>/<workspace>/<lane>/<file>.md` with a minimal body. */
function touchTask(workspace: string, lane: string, name: string): void {
    const dir = join(tmpRoot, workspace, lane);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), "---\nid: x\n---\n\n", "utf8");
}

beforeEach(() => {
    // Wipe the temp root between tests so each case starts clean.
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
});

afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
});

describe("listWorkspaces taskCount (excludes Closed)", () => {
    it("counts tasks across Backlog + Active and skips the Closed lane", async () => {
        touchTask("ws-a", "Backlog", "one");
        touchTask("ws-a", "Backlog", "two");
        touchTask("ws-a", "Active", "three");
        touchTask("ws-a", "Closed", "four");
        touchTask("ws-a", "Closed", "five");

        const result = await listWorkspaces();
        expect(result).toEqual([
            { id: "ws-a", name: "ws/a", taskCount: 3 },
        ]);
    });

    it("shows a workspace whose only tasks are in Closed (with taskCount 0)", async () => {
        touchTask("ws-archive", "Closed", "old-1");
        touchTask("ws-archive", "Closed", "old-2");

        const result = await listWorkspaces();
        expect(result).toEqual([{ id: "ws-archive", name: "ws/archive", taskCount: 0 }]);
    });

    it("shows a workspace with no .md files at all (with taskCount 0)", async () => {
        mkdirSync(join(tmpRoot, "ws-empty", "Backlog"), { recursive: true });

        const result = await listWorkspaces();
        expect(result).toEqual([{ id: "ws-empty", name: "ws/empty", taskCount: 0 }]);
    });

    it("ignores non-directory files at TASKS_ROOT (does not list them as workspaces)", async () => {
        writeFileSync(join(tmpRoot, "stray.txt"), "not a workspace", "utf8");
        writeFileSync(join(tmpRoot, ".DS_Store"), "mac metadata", "utf8");
        touchTask("ws-real", "Backlog", "x");

        const result = await listWorkspaces();
        expect(result).toEqual([{ id: "ws-real", name: "ws/real", taskCount: 1 }]);
    });

    it("handles a workspace with mixed lanes including user-qa and zero Closed", async () => {
        touchTask("ws-mix", "Backlog", "a");
        touchTask("ws-mix", "Active", "b");
        touchTask("ws-mix", "user-qa", "c");

        const result = await listWorkspaces();
        expect(result).toEqual([
            { id: "ws-mix", name: "ws/mix", taskCount: 3 },
        ]);
    });

    it("ignores non-`.md` files inside lane dirs", async () => {
        touchTask("ws-x", "Backlog", "real");
        writeFileSync(join(tmpRoot, "ws-x", "Backlog", "readme.txt"), "not a task", "utf8");

        const result = await listWorkspaces();
        expect(result).toEqual([
            { id: "ws-x", name: "ws/x", taskCount: 1 },
        ]);
    });

    it("ignores files at the workspace root (only lane subdirs count)", async () => {
        touchTask("ws-y", "Backlog", "real");
        writeFileSync(join(tmpRoot, "ws-y", "stray.md"), "at the root, not in a lane", "utf8");

        const result = await listWorkspaces();
        expect(result).toEqual([
            { id: "ws-y", name: "ws/y", taskCount: 1 },
        ]);
    });

    it("sums across multiple workspaces (mirrors how the 'all' entry is built)", async () => {
        touchTask("ws-a", "Backlog", "a1");
        touchTask("ws-a", "Backlog", "a2");
        touchTask("ws-a", "Closed", "a3");
        touchTask("ws-b", "Active", "b1");
        touchTask("ws-b", "Closed", "b2");
        touchTask("ws-b", "Closed", "b3");

        const result = await listWorkspaces();
        const total = result.reduce((sum, w) => sum + w.taskCount, 0);
        expect(result).toHaveLength(2);
        expect(total).toBe(3); // 2 (ws-a: Backlog) + 1 (ws-b: Active)
    });
});

/** Create an empty lane folder (no tasks inside). */
function touchLane(workspace: string, lane: string): void {
    mkdirSync(join(tmpRoot, workspace, lane), { recursive: true });
}

describe("listLanes (per-workspace: every folder is a lane, empty or not)", () => {
    it("returns every subdirectory as a lane, including empty ones", async () => {
        touchTask("ws-a", "Backlog", "one");
        touchLane("ws-a", "Active");           // empty folder, no tasks
        touchTask("ws-a", "user-qa", "two");
        touchLane("ws-a", "Closed");          // empty folder, no tasks

        const result = await listLanes("ws-a");
        const sortedResult = [...result].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        expect(sortedResult).toEqual([
            { name: "Active",  tasks: [] },   // empty lanes are kept
            { name: "Backlog", tasks: [{ workspace: "ws-a", lane: "Backlog", folder: "Backlog", filename: "one", title: "Untitled", priority: "medium", created: "", tags: [], uuid: "x", body: "\n" }] },
            { name: "Closed",  tasks: [] },   // empty lanes are kept
            { name: "user-qa", tasks: [{ workspace: "ws-a", lane: "user-qa", folder: "user-qa", filename: "two", title: "Untitled", priority: "medium", created: "", tags: [], uuid: "x", body: "\n" }] },
        ]);
    });

    it("returns an empty array when the workspace has no folders (no defaults)", async () => {
        mkdirSync(join(tmpRoot, "ws-empty"), { recursive: true });
        const result = await listLanes("ws-empty");
        expect(result).toEqual([]);
    });

    it("ignores regular files at the workspace root (only subdirs count)", async () => {
        touchTask("ws-b", "Backlog", "real");
        writeFileSync(join(tmpRoot, "ws-b", "stray.md"), "not a task", "utf8");

        const result = await listLanes("ws-b");
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Backlog");
    });

    it("sorts lanes case-insensitive alphabetically", async () => {
        touchLane("ws-c", "zebra");
        touchLane("ws-c", "Apple");
        touchLane("ws-c", "banana");

        const result = await listLanes("ws-c");
        expect(result.map(l => l.name)).toEqual(["Apple", "banana", "zebra"]);
    });

    it("orders default lanes Backlog → Active → QA → Closed, others after", async () => {
        touchTask("ws-d", "Backlog", "one");
        touchLane("ws-d", "Closed");
        touchLane("ws-d", "Active");
        touchLane("ws-d", "user-qa");
        touchLane("ws-d", "custom");
        touchLane("ws-d", "Review");

        const result = await listLanes("ws-d");
        expect(result.map(l => l.name)).toEqual(["Backlog", "Active", "user-qa", "Closed", "custom", "Review"]);
    });

    it("orders only the lanes that exist (visible lanes)", async () => {
        // No QA / no custom lanes in this workspace.
        touchTask("ws-e", "Backlog", "one");
        touchLane("ws-e", "Closed");

        const result = await listLanes("ws-e");
        expect(result.map(l => l.name)).toEqual(["Backlog", "Closed"]);
    });
});

describe("listAllTasksGroupedByLane (includes empty lanes since every workspace is listed)", () => {
    it("keeps a lane that exists in one workspace but has zero tasks there AND nowhere else (tasks: [])", async () => {
        // ws-p only has an empty Review folder; no other workspace has Review.
        touchLane("ws-p", "Review");
        // ws-q has Backlog with a task — that lane must appear.
        touchTask("ws-q", "Backlog", "thing");

        const result = await listAllTasksGroupedByLane();
        const names = result.map(l => l.name);

        expect(names).toContain("Backlog");
        const review = result.find(l => l.name === "Review");
        expect(review).toBeDefined();
        expect(review!.tasks).toEqual([]); // empty everywhere → still listed, with no tasks
    });

    it("keeps a lane that has tasks in one workspace even if it's empty in another", async () => {
        // Review has a task in ws-r, empty in ws-s.
        touchTask("ws-r", "Review", "needs-work");
        touchLane("ws-s", "Review");

        const result = await listAllTasksGroupedByLane();
        const review = result.find(l => l.name === "Review");
        expect(review).toBeDefined();
        expect(review!.tasks).toHaveLength(1);
    });

    it("orders default lanes Backlog → Active → QA → Closed, others after", async () => {
        touchTask("ws-t", "Closed", "done1");
        touchTask("ws-t", "Backlog", "todo1");
        touchTask("ws-t", "user-qa", "q1");
        touchTask("ws-u", "Active", "a1");
        touchTask("ws-u", "custom", "c1");

        const result = await listAllTasksGroupedByLane();
        expect(result.map(l => l.name)).toEqual(["Backlog", "Active", "user-qa", "Closed", "custom"]);
    });
});

describe("dropClosedLane", () => {
    it("removes a lane named Closed and preserves all other lanes verbatim", () => {
        const backlogTask = { workspace: "w", lane: "Backlog", folder: "Backlog", filename: "a", title: "A", priority: "medium", created: "2024-01-01", tags: [], uuid: "1" };
        const closedTask = { workspace: "w", lane: "Closed", folder: "Closed", filename: "b", title: "B", priority: "low", created: "2024-01-02", tags: [], uuid: "2" };
        const lanes: Lane[] = [
            { name: "Backlog", tasks: [backlogTask] },
            { name: "Closed", tasks: [closedTask] },
            { name: "Active", tasks: [] },
        ];

        const result = dropClosedLane(lanes);
        expect(result).toEqual([
            { name: "Backlog", tasks: [backlogTask] },
            { name: "Active", tasks: [] },
        ]);
    });

    it("removes a Closed lane even when its tasks array is empty", () => {
        const lanes: Lane[] = [
            { name: "Backlog", tasks: [] },
            { name: "Closed", tasks: [] },
        ];

        const result = dropClosedLane(lanes);
        expect(result).toEqual([{ name: "Backlog", tasks: [] }]);
    });

    it("returns [] when given []", () => {
        expect(dropClosedLane([])).toEqual([]);
    });

    it("keeps a lane named 'closed' (lowercase) since only exact 'Closed' is dropped", () => {
        const lanes: Lane[] = [
            { name: "closed", tasks: [{ workspace: "w", lane: "closed", folder: "closed", filename: "a", title: "A", priority: "medium", created: "2024-01-01", tags: [], uuid: "1" }] },
        ];

        const result = dropClosedLane(lanes);
        expect(result).toEqual(lanes);
    });
});
