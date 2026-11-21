import { describe, it, expect } from "vitest";

import {
    TASKS_ACTIONS,
    ACTION_SPECS,
    ALL_TASKS_PARAMS,
    TasksParamsSchema,
    validateTasksParams,
    emptyResultHint,
    type TasksAction,
} from "./tool-params.ts";

/**
 * The `tasks` tool is a pure dispatcher on `action`, and Pi performs no
 * runtime schema validation. These tests pin the contract that keeps a
 * mis-shaped call from being silently accepted.
 *
 * The "regression" describe block replays verbatim the six calls from session
 * 01a0ca46 (ticket-seller / Resend provider) in which the model sent
 * `action: "list"` six times while believing it was creating a task. Every one
 * of them now returns a corrective message naming `create`.
 */
describe("validateTasksParams — well-formed calls pass", () => {
    it("accepts a bare list", () => {
        expect(validateTasksParams({ action: "list" })).toBeNull();
    });

    it("accepts list with includeClosed", () => {
        expect(validateTasksParams({ action: "list", includeClosed: true })).toBeNull();
    });

    it("accepts create with only the required title", () => {
        expect(validateTasksParams({ action: "create", title: "Wire up Resend" })).toBeNull();
    });

    it("accepts create with priority and initial content", () => {
        expect(
            validateTasksParams({
                action: "create",
                title: "Wire up Resend",
                priority: "high",
                content: "## Notes",
            }),
        ).toBeNull();
    });

    it("accepts append with content", () => {
        expect(validateTasksParams({ action: "append", uuid: "aa22759f", content: "progress" })).toBeNull();
    });

    it("accepts append with file instead of content", () => {
        expect(validateTasksParams({ action: "append", uuid: "aa22759f", file: "/tmp/notes.md" })).toBeNull();
    });

    it("accepts move with uuid and folder", () => {
        expect(validateTasksParams({ action: "move", uuid: "aa22759f", folder: "Active" })).toBeNull();
    });

    it("accepts rename, delete, search, get and submit-qa in their minimal forms", () => {
        expect(validateTasksParams({ action: "rename", uuid: "aa22759f", newTitle: "New" })).toBeNull();
        expect(validateTasksParams({ action: "delete", uuid: "aa22759f" })).toBeNull();
        expect(validateTasksParams({ action: "search", name: "Resend" })).toBeNull();
        expect(validateTasksParams({ action: "get", uuid: "aa22759f" })).toBeNull();
        expect(validateTasksParams({ action: "submit-qa" })).toBeNull();
        expect(validateTasksParams({ action: "submit-qa", uuid: "aa22759f", message: "ready" })).toBeNull();
    });

    it("accepts `id` as an alias for `uuid`", () => {
        expect(validateTasksParams({ action: "get", id: "aa22759f" })).toBeNull();
        expect(validateTasksParams({ action: "move", id: "aa22759f", folder: "Closed" })).toBeNull();
    });

    it("does not flag keys explicitly set to undefined or null", () => {
        // Models and JSON round-trips routinely emit `priority: null`; that is
        // "not supplied", not "wrong parameter".
        expect(validateTasksParams({ action: "list", includeClosed: undefined })).toBeNull();
        expect(validateTasksParams({ action: "create", title: "X", content: null })).toBeNull();
    });
});

describe("validateTasksParams — regression: session 01a0ca46", () => {
    it('entry [38] {action:"list", uuid:"resend-email-provider-uat-prod"} points at get', () => {
        const problem = validateTasksParams({ action: "list", uuid: "resend-email-provider-uat-prod" });
        expect(problem).not.toBeNull();
        expect(problem!.kind).toBe("unexpected-param");
        expect(problem!.unexpected).toEqual(["uuid"]);
        expect(problem!.suggestions).toContain("get");
        expect(problem!.message).toContain('does not use "uuid"');
        expect(problem!.message).toContain("Did you mean");
    });

    it('entry [40] {action:"list", name:"Resend"} points at search', () => {
        const problem = validateTasksParams({ action: "list", name: "Resend" });
        expect(problem).not.toBeNull();
        expect(problem!.kind).toBe("unexpected-param");
        expect(problem!.suggestions).toEqual(["search"]);
        expect(problem!.message).toContain('action="search"');
    });

    it('entries [42]/[70]/[72] {action:"list", title, priority} point at create', () => {
        // This is the call the model sent three separate times, each time
        // announcing that it was "trying create explicitly".
        const problem = validateTasksParams({
            action: "list",
            title: "Resend email provider — UAT + PROD only, keep Mailpit local",
            priority: "low",
        });
        expect(problem).not.toBeNull();
        expect(problem!.kind).toBe("unexpected-param");
        expect(problem!.unexpected).toEqual(["title", "priority"]);
        // `create` accepts both, so it must rank first.
        expect(problem!.suggestions![0]).toBe("create");
        expect(problem!.message).toContain('Did you mean: tasks(action="create"');
        expect(problem!.message).toContain('title="<task title>"');
    });

    it('entry [60] {action:"list", uuid:"aa22759f"} is rejected, not silently listed', () => {
        const problem = validateTasksParams({ action: "list", uuid: "aa22759f" });
        expect(problem!.kind).toBe("unexpected-param");
        // Read-only lookups are suggested before mutating ones.
        expect(problem!.suggestions![0]).toBe("get");
    });

    it("explains that the call ran as a plain list, so the model knows why output was unchanged", () => {
        const problem = validateTasksParams({ action: "list", title: "X" });
        expect(problem!.message).toContain('so the call ran as a plain "list"');
        expect(problem!.message).toContain('"list" accepts only: includeClosed');
    });
});

describe("validateTasksParams — unexpected parameters", () => {
    it("rejects a parameter that no action accepts at all", () => {
        const problem = validateTasksParams({ action: "list", colour: "blue" });
        expect(problem!.kind).toBe("unexpected-param");
        expect(problem!.suggestions).toEqual([]);
        // With no better guess, it still restates the correct signature.
        expect(problem!.message).toContain('tasks(action="list"');
        expect(problem!.message).not.toContain("Did you mean");
    });

    it("ranks an action that covers every offending parameter above a partial match", () => {
        // `title` → create only; `folder` → move only; no action takes both.
        const problem = validateTasksParams({ action: "list", title: "X", folder: "Active" });
        expect(problem!.unexpected).toEqual(["title", "folder"]);
        expect(problem!.suggestions).toEqual(["create", "move"]);
    });

    it("treats a blank string as supplied, so it is still flagged as unexpected", () => {
        const problem = validateTasksParams({ action: "list", title: "" });
        expect(problem!.kind).toBe("unexpected-param");
    });
});

describe("validateTasksParams — missing required parameters", () => {
    it("reports a missing title for create, with the signature", () => {
        const problem = validateTasksParams({ action: "create" });
        expect(problem!.kind).toBe("missing-required");
        expect(problem!.message).toContain("title");
        expect(problem!.message).toContain('tasks(action="create"');
    });

    it("reports a blank title as missing rather than creating an untitled task", () => {
        const problem = validateTasksParams({ action: "create", title: "   " });
        expect(problem!.kind).toBe("missing-required");
    });

    it("reports a missing folder for move", () => {
        const problem = validateTasksParams({ action: "move", uuid: "aa22759f" });
        expect(problem!.kind).toBe("missing-required");
        expect(problem!.message).toContain("folder");
    });

    it("reports a missing uuid for move", () => {
        const problem = validateTasksParams({ action: "move", folder: "Active" });
        expect(problem!.kind).toBe("missing-required");
        expect(problem!.message).toContain("uuid");
    });

    it("lists every missing group at once for append", () => {
        const problem = validateTasksParams({ action: "append" });
        expect(problem!.kind).toBe("missing-required");
        expect(problem!.message).toContain("uuid (or id)");
        expect(problem!.message).toContain("content (or file for large content)");
    });

    it("reports a missing name for search", () => {
        expect(validateTasksParams({ action: "search" })!.kind).toBe("missing-required");
    });

    it("points at list/search for finding a uuid", () => {
        const problem = validateTasksParams({ action: "delete" });
        expect(problem!.message).toContain('tasks(action="list")');
    });

    it("omits the uuid lookup tip for create, which does not address a task", () => {
        const problem = validateTasksParams({ action: "create" });
        expect(problem!.message).not.toContain("Tip: find a task's uuid");
    });
});

describe("validateTasksParams — action itself", () => {
    it("reports a missing action and prints every signature", () => {
        const problem = validateTasksParams({});
        expect(problem!.kind).toBe("missing-action");
        for (const action of TASKS_ACTIONS) {
            expect(problem!.message).toContain(`action="${action}"`);
        }
        expect(problem!.message).toContain('"action" is required');
    });

    it("reports a blank action as missing", () => {
        expect(validateTasksParams({ action: "" })!.kind).toBe("missing-action");
    });

    it("reports an unknown action and lists the valid ones", () => {
        const problem = validateTasksParams({ action: "create-task" });
        expect(problem!.kind).toBe("unknown-action");
        expect(problem!.action).toBe("create-task");
        expect(problem!.message).toContain("unknown action");
        expect(problem!.message).toContain(TASKS_ACTIONS.join(", "));
    });

    it("reports a non-string action", () => {
        expect(validateTasksParams({ action: 42 })!.kind).toBe("unknown-action");
    });

    it("rejects non-object params", () => {
        expect(validateTasksParams(null)!.kind).toBe("not-an-object");
        expect(validateTasksParams("list")!.kind).toBe("not-an-object");
        expect(validateTasksParams(["list"])!.kind).toBe("not-an-object");
        expect(validateTasksParams(undefined)!.kind).toBe("not-an-object");
    });
});

describe("ACTION_SPECS / schema consistency", () => {
    it("has a spec for every declared action", () => {
        for (const action of TASKS_ACTIONS) {
            expect(ACTION_SPECS[action], `missing spec for ${action}`).toBeDefined();
            expect(ACTION_SPECS[action].signature).toContain(`action="${action}"`);
            expect(ACTION_SPECS[action].summary.length).toBeGreaterThan(0);
        }
    });

    it("has no spec for an action that is not declared", () => {
        expect(Object.keys(ACTION_SPECS).sort()).toEqual([...TASKS_ACTIONS].sort());
    });

    it("exposes in the TypeBox schema exactly the parameters the specs accept", () => {
        // Guards against drift: a new parameter added to a spec must be added
        // to the model-facing schema, and vice versa.
        const schemaProps = Object.keys(TasksParamsSchema.properties).filter((k) => k !== "action");
        expect(schemaProps.sort()).toEqual(ALL_TASKS_PARAMS);
    });

    it("requires `action` at the schema level", () => {
        expect(TasksParamsSchema.required).toContain("action");
    });

    it("derives ALL_TASKS_PARAMS without duplicates", () => {
        expect(new Set(ALL_TASKS_PARAMS).size).toBe(ALL_TASKS_PARAMS.length);
        // `uuid` and `id` are aliases used by several actions but listed once.
        expect(ALL_TASKS_PARAMS).toContain("uuid");
        expect(ALL_TASKS_PARAMS).toContain("id");
    });
});

describe("emptyResultHint", () => {
    it("suggests create when there is nothing to list", () => {
        expect(emptyResultHint("list")).toContain('action="create"');
    });

    it("suggests list or create when a search misses", () => {
        const hint = emptyResultHint("search")!;
        expect(hint).toContain('action="list"');
        expect(hint).toContain('action="create"');
    });

    it("points uuid-based actions back at list", () => {
        for (const action of ["get", "append", "move", "rename", "delete"] as TasksAction[]) {
            expect(emptyResultHint(action), `no hint for ${action}`).toContain('action="list"');
        }
    });

    it("returns null where no next step applies", () => {
        expect(emptyResultHint("create")).toBeNull();
        expect(emptyResultHint("submit-qa")).toBeNull();
    });
});
