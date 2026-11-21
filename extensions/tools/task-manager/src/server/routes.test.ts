import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the tasks lib so we don't touch the real filesystem.
vi.mock("../tasks/index.ts", () => {
    return {
        listWorkspaces: vi.fn(),
        listLanes: vi.fn(),
        listAllTasksGroupedByLane: vi.fn(),
        getTaskFile: vi.fn(),
        createTaskFile: vi.fn(),
        updateTaskFile: vi.fn(),
        moveTaskBetweenLanes: vi.fn(),
        existsLane: vi.fn(),
        parseBody: (content: string) => {
            // Minimal stand-in so route handlers don't import the real file.
            const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
            return match ? content.slice(match[0].length) : content;
        },
        // Re-export the real TASKS_ROOT so route guards resolve against the
        // actual root (which the mocked functions never call anyway).
        TASKS_ROOT: "/tmp/.pi/tasks-test",
    };
});

// Mock the markdown renderer so we don't depend on marked/DOMPurify in these tests.
vi.mock("./markdown.ts", () => {
    return {
        renderMarkdown: vi.fn((md: string) => `<rendered>${md}</rendered>`),
    };
});

import {
    handleHealth,
    handleListWorkspaces,
    handleGetWorkspace,
    handleGetTask,
    handleCreateTask,
    handleUpdateTask,
    handleMoveTask,
    handleShutdown,
} from "./routes.ts";
import {
    listWorkspaces,
    listLanes,
    listAllTasksGroupedByLane,
    getTaskFile,
    createTaskFile,
    updateTaskFile,
    moveTaskBetweenLanes,
    existsLane,
} from "../tasks/index.ts";

const listWorkspacesMock = listWorkspaces as unknown as ReturnType<typeof vi.fn>;
const listLanesMock = listLanes as unknown as ReturnType<typeof vi.fn>;
const listAllMock = listAllTasksGroupedByLane as unknown as ReturnType<typeof vi.fn>;
const getTaskFileMock = getTaskFile as unknown as ReturnType<typeof vi.fn>;
const createTaskFileMock = createTaskFile as unknown as ReturnType<typeof vi.fn>;
const updateTaskFileMock = updateTaskFile as unknown as ReturnType<typeof vi.fn>;
const moveTaskBetweenLanesMock = moveTaskBetweenLanes as unknown as ReturnType<typeof vi.fn>;
const existsLaneMock = existsLane as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
    listWorkspacesMock.mockReset();
    listLanesMock.mockReset();
    listAllMock.mockReset();
    getTaskFileMock.mockReset();
    createTaskFileMock.mockReset();
    updateTaskFileMock.mockReset();
    moveTaskBetweenLanesMock.mockReset();
    existsLaneMock.mockReset();
});

describe("handleHealth", () => {
    it("returns ok: true with a version string", async () => {
        const res = await handleHealth();
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as { ok: boolean; version: string };
        expect(body.ok).toBe(true);
        expect(typeof body.version).toBe("string");
        expect(body.version.length).toBeGreaterThan(0);
    });
});

describe("handleListWorkspaces", () => {
    it("prepends the 'all' entry whose taskCount is the sum of the rest", async () => {
        listWorkspacesMock.mockResolvedValueOnce([
            { id: "ws-a", name: "ws/a", taskCount: 12 },
            { id: "ws-b", name: "ws/b", taskCount: 35 },
        ]);

        const res = await handleListWorkspaces();
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as {
            workspaces: Array<{ id: string; name: string; taskCount: number }>;
        };
        expect(body.workspaces).toHaveLength(3);
        expect(body.workspaces[0]).toEqual({
            id: "all",
            name: "All projects",
            taskCount: 47,
        });
        expect(body.workspaces[1].id).toBe("ws-a");
        expect(body.workspaces[2].id).toBe("ws-b");
    });

    it("returns only the 'all' entry (with taskCount 0) when no workspaces exist", async () => {
        listWorkspacesMock.mockResolvedValueOnce([]);

        const res = await handleListWorkspaces();
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as {
            workspaces: Array<{ id: string; taskCount: number }>;
        };
        expect(body.workspaces).toEqual([
            { id: "all", name: "All projects", taskCount: 0 },
        ]);
    });
});

describe("handleGetWorkspace", () => {
    it("returns lanes from listAllTasksGroupedByLane for id='all'", async () => {
        const lanes = [
            { name: "Active", tasks: [{ workspace: "ws-a", filename: "b", title: "B", lane: "Active", folder: "Active", priority: "low", created: "", tags: [], uuid: "u" }] },
            { name: "Backlog", tasks: [{ workspace: "ws-b", filename: "a", title: "A", lane: "Backlog", folder: "Backlog", priority: "low", created: "", tags: [], uuid: "u2" }] },
        ];
        listAllMock.mockResolvedValueOnce(lanes);

        const res = await handleGetWorkspace("all");
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as { workspace: { id: string; name: string }; lanes: typeof lanes };
        expect(body.workspace).toEqual({ id: "all", name: "All projects" });
        expect(body.lanes).toBe(lanes);
    });

    it("returns the matching workspace + its lanes for a real workspace id", async () => {
        listWorkspacesMock.mockResolvedValueOnce([
            { id: "ws-a", name: "ws/a", taskCount: 1 },
            { id: "ws-b", name: "ws/b", taskCount: 2 },
        ]);
        const lanes = [
            { name: "Backlog", tasks: [] },
            { name: "Active", tasks: [{ workspace: "ws-b", lane: "Active", folder: "Active", filename: "x", title: "X", priority: "high", created: "2025-01-01", tags: [], uuid: "u" }] },
        ];
        listLanesMock.mockResolvedValueOnce(lanes);

        const res = await handleGetWorkspace("ws-b");
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as { workspace: { id: string; name: string }; lanes: typeof lanes };
        expect(body.workspace).toEqual({ id: "ws-b", name: "ws/b" });
        expect(body.lanes).toBe(lanes);
        expect(listLanesMock).toHaveBeenCalledWith("ws-b");
    });

    it("returns 404 for a nonexistent workspace id", async () => {
        listWorkspacesMock.mockResolvedValueOnce([
            { id: "ws-a", name: "ws/a", taskCount: 1 },
        ]);

        const res = await handleGetWorkspace("nonexistent");
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Workspace not found" });
    });

    it("returns 400 when the workspace id would escape TASKS_ROOT", async () => {
        const res = await handleGetWorkspace("..");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/workspace/i);
    });
});

describe("handleGetTask", () => {
    it("returns 404 when getTaskFile returns null", async () => {
        getTaskFileMock.mockResolvedValueOnce(null);

        const res = await handleGetTask("ws-a", "Backlog", "missing");
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Task not found" });
        expect(getTaskFileMock).toHaveBeenCalledWith("ws-a", "Backlog", "missing");
    });

    it("returns the full task payload on success", async () => {
        const frontmatter = {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "design-auth",
            title: "Design auth flow",
            priority: "high",
            created: "2025-06-10",
            tags: ["auth", "backend"],
            uuid: "uuid-1",
        };
        getTaskFileMock.mockResolvedValueOnce({
            rawMarkdown: "---\nid: uuid-1\ntitle: Design auth flow\ncreated: 2025-06-10\npriority: high\ntags:\n  - auth\n  - backend\n---\n\n# Design auth flow\n\nBody.",
            frontmatter,
        });

        const res = await handleGetTask("ws-a", "Backlog", "design-auth");
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as {
            workspace: string;
            lane: string;
            filename: string;
            frontmatter: { id: string; title: string; priority: string; created: string; tags: string[] };
            bodyHtml: string;
            rawMarkdown: string;
            body: string;
        };
        expect(body.workspace).toBe("ws-a");
        expect(body.lane).toBe("Backlog");
        expect(body.filename).toBe("design-auth");
        expect(body.frontmatter).toEqual({
            id: "uuid-1",
            title: "Design auth flow",
            priority: "high",
            created: "2025-06-10",
            tags: ["auth", "backend"],
        });
        expect(body.bodyHtml).toContain("<rendered>");
        expect(body.bodyHtml).toContain("Design auth flow");
        expect(body.rawMarkdown).toContain("uuid-1");
        // The `body` field is the markdown AFTER the frontmatter.
        expect(body.body).toContain("# Design auth flow");
        expect(body.body).toContain("Body.");
    });

    it("returns the body field (may be empty) when the file has no body", async () => {
        const frontmatter = {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "empty-body",
            title: "Empty body",
            priority: "medium",
            created: "2025-06-10",
            tags: [],
            uuid: "uuid-2",
        };
        getTaskFileMock.mockResolvedValueOnce({
            rawMarkdown: "---\nid: uuid-2\ntitle: Empty body\ncreated: 2025-06-10\npriority: medium\ntags:\n---\n\n",
            frontmatter,
        });

        const res = await handleGetTask("ws-a", "Backlog", "empty-body");
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as { body: string };
        // parseBody strips the frontmatter block; an empty body yields only
        // the trailing newline after the closing `---`.
        expect(typeof body.body).toBe("string");
        expect(body.body).not.toContain("id: uuid-2");
    });

    it("decodes URL-encoded params before calling getTaskFile", async () => {
        getTaskFileMock.mockResolvedValueOnce(null);

        // Simulate URL-decoded values being passed in (the HTTP layer is
        // responsible for decoding; the handler should receive plain text).
        const res = await handleGetTask(
            "ws-with%20space".replace(/%20/g, " "),
            "Backlog",
            "task%20name".replace(/%20/g, " "),
        );
        // 404 because getTaskFile returned null in the mock.
        expect(res.status).toBe(404);
        // Verify the handler passed the DECODED values to getTaskFile.
        expect(getTaskFileMock).toHaveBeenCalledWith("ws-with space", "Backlog", "task name");
    });

    it("returns 400 on a path-traversal attempt (workspace='..')", async () => {
        const res = await handleGetTask("..", "Backlog", "x");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/path/i);
        expect(getTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 when a segment contains a path separator", async () => {
        const res = await handleGetTask("ws-a", "Backlog/sub", "x");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(getTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 when any segment is empty", async () => {
        const res = await handleGetTask("ws-a", "", "x");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(getTaskFileMock).not.toHaveBeenCalled();
    });
});

describe("handleCreateTask", () => {
    const createdResult = {
        rawMarkdown: "---\nid: uuid-new\ntitle: New Task\ncreated: 2026-08-02\npriority: high\ntags:\n  - frontend\n---\n\n## Notes\nBody text.",
        frontmatter: {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "New-Task",
            title: "New Task",
            priority: "high",
            created: "2026-08-02",
            tags: ["frontend"],
            uuid: "uuid-new",
        },
    };

    it("returns 201 with the created payload on success", async () => {
        listWorkspacesMock.mockResolvedValueOnce([{ id: "ws-a", name: "ws/a", taskCount: 1 }]);
        createTaskFileMock.mockResolvedValueOnce(createdResult);

        const res = await handleCreateTask({
            workspace: "ws-a",
            lane: "Backlog",
            title: "New Task",
            priority: "high",
            tags: ["frontend"],
            body: "## Notes\nBody text.",
        });
        expect(res.status).toBe(201);
        if (res.status !== 201) return;
        const body = res.body as {
            workspace: string;
            lane: string;
            filename: string;
            frontmatter: { id: string; title: string; created: string; priority: string; tags: string[] };
            body: string;
        };
        expect(body.workspace).toBe("ws-a");
        expect(body.lane).toBe("Backlog");
        expect(body.filename).toBe("New-Task");
        expect(body.frontmatter).toEqual({
            id: "uuid-new",
            title: "New Task",
            created: "2026-08-02",
            priority: "high",
            tags: ["frontend"],
        });
        expect(body.body).toContain("## Notes");
        expect(createTaskFileMock).toHaveBeenCalledWith("ws-a", "Backlog", {
            title: "New Task",
            priority: "high",
            tags: ["frontend"],
            body: "## Notes\nBody text.",
        });
    });

    it("defaults lane to Backlog, priority to medium, tags to [], body to ''", async () => {
        listWorkspacesMock.mockResolvedValueOnce([{ id: "ws-a", name: "ws/a", taskCount: 1 }]);
        createTaskFileMock.mockResolvedValueOnce(createdResult);

        const res = await handleCreateTask({ workspace: "ws-a", title: "New Task" });
        expect(res.status).toBe(201);
        expect(createTaskFileMock).toHaveBeenCalledWith("ws-a", "Backlog", {
            title: "New Task",
            priority: "medium",
            tags: [],
            body: "",
        });
    });

    it("returns 400 for a missing title", async () => {
        const res = await handleCreateTask({ workspace: "ws-a", title: "" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/title/i);
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid priority", async () => {
        const res = await handleCreateTask({ workspace: "ws-a", title: "X", priority: "urgent" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/priority/i);
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a workspace with path separators", async () => {
        const res = await handleCreateTask({ workspace: "ws/../evil", title: "X" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a lane with path separators", async () => {
        const res = await handleCreateTask({ workspace: "ws-a", lane: "Backlog/../evil", title: "X" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for tags that are not an array of strings", async () => {
        const res = await handleCreateTask({ workspace: "ws-a", title: "X", tags: [1, 2] });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/tags/i);
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-string body", async () => {
        const res = await handleCreateTask({ workspace: "ws-a", title: "X", body: 42 });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/body/i);
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid JSON body (non-object)", async () => {
        const res = await handleCreateTask("not-an-object");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/JSON/i);
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 404 when the workspace is not in listWorkspaces", async () => {
        listWorkspacesMock.mockResolvedValueOnce([{ id: "ws-a", name: "ws/a", taskCount: 1 }]);

        const res = await handleCreateTask({ workspace: "ws-unknown", title: "X" });
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Workspace not found" });
        expect(createTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 500 when createTaskFile throws", async () => {
        listWorkspacesMock.mockResolvedValueOnce([{ id: "ws-a", name: "ws/a", taskCount: 1 }]);
        createTaskFileMock.mockRejectedValueOnce(new Error("disk full"));

        const res = await handleCreateTask({ workspace: "ws-a", title: "X" });
        expect(res.status).toBe(500);
        if (res.status !== 500) return;
        expect(res.body).toEqual({ error: "Internal server error" });
    });
});

describe("handleUpdateTask", () => {
    const existingResult = {
        rawMarkdown: "---\nid: uuid-keep\ntitle: Old Title\ncreated: 2025-01-01\npriority: medium\ntags:\n  - old\n---\n\nOld body.",
        frontmatter: {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "old-title",
            title: "Old Title",
            priority: "medium",
            created: "2025-01-01",
            tags: ["old"],
            uuid: "uuid-keep",
        },
    };
    const updatedResult = {
        rawMarkdown: "---\nid: uuid-keep\ntitle: New Title\ncreated: 2025-01-01\npriority: high\ntags:\n  - new\n---\n\nNew body.",
        frontmatter: {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "old-title",
            title: "New Title",
            priority: "high",
            created: "2025-01-01",
            tags: ["new"],
            uuid: "uuid-keep",
        },
    };

    it("returns 200 with the full task payload on success", async () => {
        getTaskFileMock.mockResolvedValueOnce(existingResult);
        updateTaskFileMock.mockResolvedValueOnce(updatedResult);

        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", {
            title: "New Title",
            priority: "high",
            tags: ["new"],
            body: "New body.",
        });
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as {
            workspace: string;
            lane: string;
            filename: string;
            frontmatter: { id: string; title: string; created: string; priority: string; tags: string[] };
            bodyHtml: string;
            rawMarkdown: string;
            body: string;
        };
        expect(body.workspace).toBe("ws-a");
        expect(body.lane).toBe("Backlog");
        expect(body.filename).toBe("old-title");
        expect(body.frontmatter).toEqual({
            id: "uuid-keep",
            title: "New Title",
            created: "2025-01-01",
            priority: "high",
            tags: ["new"],
        });
        expect(body.bodyHtml).toContain("<rendered>");
        expect(body.rawMarkdown).toContain("uuid-keep");
        expect(body.body).toContain("New body.");
        // The draft merged omitted fields from the existing file.
        expect(updateTaskFileMock).toHaveBeenCalledWith("ws-a", "Backlog", "old-title", {
            title: "New Title",
            priority: "high",
            tags: ["new"],
            body: "New body.",
        });
    });

    it("keeps current values for omitted fields", async () => {
        getTaskFileMock.mockResolvedValueOnce(existingResult);
        updateTaskFileMock.mockResolvedValueOnce(updatedResult);

        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", {
            title: "New Title",
        });
        expect(res.status).toBe(200);
        // priority/tags/body come from the existing file (parseBody keeps
        // the leading newline after the closing `---`).
        expect(updateTaskFileMock).toHaveBeenCalledWith("ws-a", "Backlog", "old-title", {
            title: "New Title",
            priority: "medium",
            tags: ["old"],
            body: "\nOld body.",
        });
    });

    it("returns 400 for an invalid title", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", { title: "" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/title/i);
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid priority", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", { priority: "urgent" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/priority/i);
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid tags", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", { tags: "not-array" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/tags/i);
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a non-string body", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", { body: 42 });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/body/i);
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid JSON body (non-object)", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", "nope");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/JSON/i);
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for path separators in a segment", async () => {
        const res = await handleUpdateTask("ws-a", "Backlog/sub", "old-title", { title: "X" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a path-traversal attempt", async () => {
        const res = await handleUpdateTask("..", "Backlog", "old-title", { title: "X" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 404 when the task file does not exist", async () => {
        getTaskFileMock.mockResolvedValueOnce(null);

        const res = await handleUpdateTask("ws-a", "Backlog", "missing", { title: "X" });
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Task not found" });
        expect(updateTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 500 when updateTaskFile throws", async () => {
        getTaskFileMock.mockResolvedValueOnce(existingResult);
        updateTaskFileMock.mockRejectedValueOnce(new Error("disk full"));

        const res = await handleUpdateTask("ws-a", "Backlog", "old-title", { title: "New Title" });
        expect(res.status).toBe(500);
        if (res.status !== 500) return;
        expect(res.body).toEqual({ error: "Internal server error" });
    });
});

describe("handleMoveTask", () => {
    const movedResult = {
        rawMarkdown: "---\nid: uuid-keep\ntitle: Design auth\ncreated: 2025-06-10\npriority: high\ntags:\n  - auth\n---\n\n# Design auth\n\nBody.",
        frontmatter: {
            workspace: "ws-a",
            lane: "Active",
            folder: "Active",
            filename: "design-auth",
            title: "Design auth",
            priority: "high",
            created: "2025-06-10",
            tags: ["auth"],
            uuid: "uuid-keep",
        },
    };
    const existingResult = {
        rawMarkdown: "---\nid: uuid-keep\ntitle: Design auth\ncreated: 2025-06-10\npriority: high\ntags:\n  - auth\n---\n\n# Design auth\n\nBody.",
        frontmatter: {
            workspace: "ws-a",
            lane: "Backlog",
            folder: "Backlog",
            filename: "design-auth",
            title: "Design auth",
            priority: "high",
            created: "2025-06-10",
            tags: ["auth"],
            uuid: "uuid-keep",
        },
    };

    it("returns 200 with the task payload reflecting the new lane on success", async () => {
        existsLaneMock.mockResolvedValueOnce(true);
        moveTaskBetweenLanesMock.mockResolvedValueOnce(movedResult);

        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "Active" });
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as {
            workspace: string;
            lane: string;
            filename: string;
            frontmatter: { id: string; title: string; created: string; priority: string; tags: string[] };
            bodyHtml: string;
            body: string;
        };
        expect(body.lane).toBe("Active");
        expect(body.workspace).toBe("ws-a");
        expect(body.filename).toBe("design-auth");
        expect(body.frontmatter).toEqual({
            id: "uuid-keep",
            title: "Design auth",
            created: "2025-06-10",
            priority: "high",
            tags: ["auth"],
        });
        expect(body.bodyHtml).toContain("<rendered>");
        expect(body.body).toContain("Body.");
        expect(moveTaskBetweenLanesMock).toHaveBeenCalledWith("ws-a", "Backlog", "Active", "design-auth");
    });

    it("returns 400 when a path segment contains a separator", async () => {
        const res = await handleMoveTask("ws-a", "Backlog/sub", "design-auth", { lane: "Active" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/path/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid JSON body (non-object)", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", "nope");
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/JSON/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a missing or empty lane field in the body", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", {});
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/lane/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();

        const res2 = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "" });
        expect(res2.status).toBe(400);
        if (res2.status !== 400) return;
        expect((res2.body as { error: string }).error).toMatch(/lane/i);
    });

    it("returns 400 for a lane with path separators in the body", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "Active/../evil" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/lane/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 404 Lane not found when the target lane does not exist and does NOT call the mover", async () => {
        existsLaneMock.mockResolvedValueOnce(false);

        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "Unknown" });
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Lane not found" });
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
        expect(getTaskFileMock).not.toHaveBeenCalled();
    });

    it("returns 404 Task not found when the source task is missing", async () => {
        existsLaneMock.mockResolvedValueOnce(true);
        moveTaskBetweenLanesMock.mockResolvedValueOnce(null);

        const res = await handleMoveTask("ws-a", "Backlog", "missing", { lane: "Active" });
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Task not found" });
        expect(moveTaskBetweenLanesMock).toHaveBeenCalledWith("ws-a", "Backlog", "Active", "missing");
    });

    it("returns 404 Task not found on a same-lane no-op when the task is missing", async () => {
        existsLaneMock.mockResolvedValueOnce(true);
        getTaskFileMock.mockResolvedValueOnce(null);

        const res = await handleMoveTask("ws-a", "Backlog", "missing", { lane: "Backlog" });
        expect(res.status).toBe(404);
        if (res.status !== 404) return;
        expect(res.body).toEqual({ error: "Task not found" });
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 200 unchanged on a same-lane no-op without calling the mover", async () => {
        existsLaneMock.mockResolvedValueOnce(true);
        getTaskFileMock.mockResolvedValueOnce(existingResult);

        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "Backlog" });
        expect(res.status).toBe(200);
        if (res.status !== 200) return;
        const body = res.body as { lane: string; frontmatter: { id: string } };
        expect(body.lane).toBe("Backlog");
        expect(body.frontmatter.id).toBe("uuid-keep");
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 500 when moveTaskBetweenLanes throws", async () => {
        existsLaneMock.mockResolvedValueOnce(true);
        moveTaskBetweenLanesMock.mockRejectedValueOnce(new Error("disk full"));

        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "Active" });
        expect(res.status).toBe(500);
        if (res.status !== 500) return;
        expect(res.body).toEqual({ error: "Internal server error" });
    });

    // Regression for the `.` / `..` lane bypass that `path.resolve` would
    // normalize into parent traversal: `existsLane(ws, "..")` resolved to
    // TASKS_ROOT (a directory), so a crafted move could relocate a task file
    // out of its workspace. The target lane must be rejected outright.
    it("returns 400 for target lane '..' (parent-traversal bypass)", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: ".." });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/lane/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 400 for target lane '.' ", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "design-auth", { lane: "." });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/lane/i);
        expect(moveTaskBetweenLanesMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a source lane of '..' (read-side escape)", async () => {
        const res = await handleMoveTask("ws-a", "..", "design-auth", { lane: "Active" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/path/i);
        expect(existsLaneMock).not.toHaveBeenCalled();
    });

    it("returns 400 for a filename of '..' ", async () => {
        const res = await handleMoveTask("ws-a", "Backlog", "..", { lane: "Active" });
        expect(res.status).toBe(400);
        if (res.status !== 400) return;
        expect(res.body.error).toMatch(/path/i);
    });
});

describe("handleShutdown", () => {
    it("returns 200 immediately and invokes the stop callback asynchronously", async () => {
        const stop = vi.fn();
        const res = await handleShutdown(stop);
        // Response is fast so the HTTP layer can flush before closing.
        expect(res.status).toBe(200);
        // Stop is deferred via setImmediate, so it hasn't fired yet.
        expect(stop).not.toHaveBeenCalled();
        // After the immediate queue drains, the callback runs.
        await new Promise<void>((r) => setImmediate(r));
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it("swallows errors from the stop callback", async () => {
        const stop = vi.fn(() => {
            throw new Error("boom");
        });
        // Should NOT reject — the server is going away anyway.
        const res = await handleShutdown(stop);
        expect(res.status).toBe(200);
        await new Promise<void>((r) => setImmediate(r));
        expect(stop).toHaveBeenCalledTimes(1);
    });
});
