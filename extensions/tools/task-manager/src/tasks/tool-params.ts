/**
 * Parameter validation and the model-facing JSON schema for the `tasks` tool.
 *
 * ## Why this module exists
 *
 * Pi does **not** validate tool-call arguments against the registered JSON
 * schema before invoking `execute()` — the schema is only serialized and sent
 * to the model. That means any parameter the model invents is passed straight
 * through, and a `switch (params.action)` implementation silently ignores
 * everything it does not read.
 *
 * The failure mode this produces is subtle and expensive: a model that sends
 * `{action: "list", title: "Fix login"}` gets back a perfectly valid task
 * list. Nothing errors. The model concludes "the create action is broken",
 * retries with different payload fields, gets the same list again, and can
 * burn an entire session without ever discovering that `action` is the field
 * that selects the behaviour.
 *
 * So validation lives here, in the extension, and is deliberately
 * **self-teaching**: every rejection names the action that *does* accept the
 * offending parameter and prints a copy-pasteable signature. The goal is that
 * a single bad call is enough for the model to self-correct.
 *
 * The TypeBox schema lives here too, next to the enforcement table, so the
 * model-facing contract and the runtime contract cannot drift apart (a test
 * asserts they agree).
 */

import { Type } from "typebox";
import type { Static } from "typebox";

/** Every action the `tasks` tool accepts, in canonical declaration order. */
export const TASKS_ACTIONS = [
    "list",
    "create",
    "move",
    "append",
    "delete",
    "rename",
    "search",
    "get",
    "submit-qa",
] as const;

/** Union of {@link TASKS_ACTIONS}. */
export type TasksAction = (typeof TASKS_ACTIONS)[number];

/**
 * A set of mutually-substitutable parameter names, at least one of which must
 * be present. Used to express "uuid OR id" without inventing a schema for it.
 */
export interface RequiredGroup {
    /** Parameter names that satisfy this requirement (any one of them). */
    params: string[];
    /** Human-readable label for the group, used in error messages. */
    label: string;
}

/** Per-action contract: what it reads, what it needs, and how to call it. */
export interface ActionSpec {
    /** One-line description of what the action does. */
    summary: string;
    /**
     * Parameters this action actually reads, excluding `action` itself.
     * Anything outside this list is rejected rather than ignored.
     */
    accepts: string[];
    /** Groups that must each be satisfied. Empty for actions with no args. */
    required: RequiredGroup[];
    /** A copy-pasteable call signature shown in errors and hints. */
    signature: string;
}

/**
 * The full contract table for the `tasks` tool.
 *
 * Keep this in sync with `TasksParamsSchema` in `index.ts` (the schema tells
 * the model what exists; this table enforces which action may use what).
 */
export const ACTION_SPECS: Record<TasksAction, ActionSpec> = {
    list: {
        summary: "Show tasks grouped by folder (Closed excluded unless includeClosed=true).",
        accepts: ["includeClosed"],
        required: [],
        signature: 'tasks(action="list", includeClosed?=true)',
    },
    create: {
        summary: "Create a new task in Backlog.",
        accepts: ["title", "priority", "content"],
        required: [{ params: ["title"], label: "title" }],
        signature:
            'tasks(action="create", title="<task title>", priority?="low|medium|high|critical", content?="<initial notes>")',
    },
    move: {
        summary: "Move a task between folders.",
        accepts: ["uuid", "id", "folder"],
        required: [
            { params: ["uuid", "id"], label: "uuid (or id)" },
            { params: ["folder"], label: 'folder ("Backlog" | "Active" | "Closed")' },
        ],
        signature: 'tasks(action="move", uuid="<task uuid>", folder="Backlog|Active|Closed")',
    },
    append: {
        summary: "Append progress notes to a task.",
        accepts: ["uuid", "id", "content", "file"],
        required: [
            { params: ["uuid", "id"], label: "uuid (or id)" },
            { params: ["content", "file"], label: "content (or file for large content)" },
        ],
        signature: 'tasks(action="append", uuid="<task uuid>", content="<text>")  // or file="<path>"',
    },
    delete: {
        summary: "Delete a task.",
        accepts: ["uuid", "id"],
        required: [{ params: ["uuid", "id"], label: "uuid (or id)" }],
        signature: 'tasks(action="delete", uuid="<task uuid>")',
    },
    rename: {
        summary: "Rename a task.",
        accepts: ["uuid", "id", "newTitle"],
        required: [
            { params: ["uuid", "id"], label: "uuid (or id)" },
            { params: ["newTitle"], label: "newTitle" },
        ],
        signature: 'tasks(action="rename", uuid="<task uuid>", newTitle="<new title>")',
    },
    search: {
        summary: "Find a task by (partial) title.",
        accepts: ["name"],
        required: [{ params: ["name"], label: "name" }],
        signature: 'tasks(action="search", name="<partial title>")',
    },
    get: {
        summary: "Read a single task's full content.",
        accepts: ["uuid", "id"],
        required: [{ params: ["uuid", "id"], label: "uuid (or id)" }],
        signature: 'tasks(action="get", uuid="<task uuid>")',
    },
    "submit-qa": {
        summary: "Submit the active task to QA.",
        accepts: ["uuid", "id", "message"],
        required: [],
        signature: 'tasks(action="submit-qa", uuid?="<task uuid>", message?="<note for QA>")',
    },
};

/**
 * Ordering used when suggesting alternative actions. Read-only lookups come
 * first so a confused model is nudged toward inspecting state before mutating
 * it, then creation, then the destructive/transition actions.
 */
const SUGGESTION_ORDER: TasksAction[] = [
    "get",
    "search",
    "list",
    "create",
    "append",
    "move",
    "rename",
    "delete",
    "submit-qa",
];

/** A validation failure, ready to be rendered back to the model. */
export interface TasksParamProblem {
    /** Discriminator so callers/tests can branch without string matching. */
    kind: "not-an-object" | "missing-action" | "unknown-action" | "unexpected-param" | "missing-required";
    /** Self-teaching message: what was wrong + how to call it correctly. */
    message: string;
    /** The `action` value as received, when one was present. */
    action?: string;
    /** Parameter names that were rejected (for `unexpected-param`). */
    unexpected?: string[];
    /** Actions that would accept the rejected parameters, best match first. */
    suggestions?: TasksAction[];
}

/**
 * True when the caller did not send this key at all.
 *
 * Used for unexpected-parameter detection: a key the model explicitly sent
 * (even as `""`) still counts as supplied, so it gets flagged rather than
 * silently ignored.
 */
function isOmitted(value: unknown): boolean {
    return value === undefined || value === null;
}

/**
 * True when a value cannot satisfy a requirement: absent, or a blank string.
 *
 * Blank strings are treated as missing so `{action:"create", title:""}` is
 * reported as "missing title" instead of creating an untitled task.
 */
function isBlank(value: unknown): boolean {
    return isOmitted(value) || (typeof value === "string" && value.trim() === "");
}

/** Parameter names the caller actually sent, minus `action`. */
function suppliedKeys(params: Record<string, unknown>): string[] {
    return Object.keys(params).filter((k) => k !== "action" && !isOmitted(params[k]));
}

/**
 * Rank actions by how well they explain the rejected parameters.
 *
 * An action that accepts *all* of them is a far better guess than one that
 * accepts only some, so full coverage sorts first; ties break on
 * {@link SUGGESTION_ORDER}.
 */
function rankSuggestions(unexpected: string[]): TasksAction[] {
    const scored = SUGGESTION_ORDER.map((action) => {
        const accepts = ACTION_SPECS[action].accepts;
        const covered = unexpected.filter((p) => accepts.includes(p)).length;
        return { action, covered, order: SUGGESTION_ORDER.indexOf(action) };
    });
    return scored
        .filter((s) => s.covered > 0)
        .sort((a, b) => b.covered - a.covered || a.order - b.order)
        .map((s) => s.action);
}

/** All action signatures, one per line — used when the action itself is unusable. */
function allSignatures(): string {
    return SUGGESTION_ORDER.map((a) => `  ${ACTION_SPECS[a].signature}`).join("\n");
}

/**
 * Validate the arguments of a `tasks` tool call.
 *
 * Returns `null` when the call is well-formed. Otherwise returns a
 * {@link TasksParamProblem} whose `message` is written for a model to read and
 * act on: it states what was ignored or missing, names the action that fits,
 * and prints the correct signature.
 *
 * Pure and synchronous — no filesystem access — so it is trivially testable.
 */
export function validateTasksParams(params: unknown): TasksParamProblem | null {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
        return {
            kind: "not-an-object",
            message:
                "Error: tasks() expects a single JSON object of parameters.\n" +
                `Available actions:\n${allSignatures()}`,
        };
    }

    const record = params as Record<string, unknown>;
    const rawAction = record.action;

    if (isBlank(rawAction)) {
        return {
            kind: "missing-action",
            message:
                'Error: "action" is required — it selects which operation runs; every other parameter is only meaningful for a specific action.\n' +
                `Available actions:\n${allSignatures()}`,
        };
    }

    if (typeof rawAction !== "string" || !(TASKS_ACTIONS as readonly string[]).includes(rawAction)) {
        return {
            kind: "unknown-action",
            action: typeof rawAction === "string" ? rawAction : String(rawAction),
            message:
                `Error: unknown action ${JSON.stringify(rawAction)}.\n` +
                `Valid actions are: ${TASKS_ACTIONS.join(", ")}.\n` +
                `Signatures:\n${allSignatures()}`,
        };
    }

    const action = rawAction as TasksAction;
    const spec = ACTION_SPECS[action];
    const supplied = suppliedKeys(record);

    // 1. Reject parameters this action does not read. Silently ignoring them
    //    is what makes a wrong `action` look like a broken tool.
    const unexpected = supplied.filter((k) => !spec.accepts.includes(k));
    if (unexpected.length > 0) {
        const suggestions = rankSuggestions(unexpected);
        const lines: string[] = [
            `Error: action "${action}" does not use ${unexpected.map((u) => `"${u}"`).join(", ")} — ${
                unexpected.length === 1 ? "it was" : "they were"
            } ignored, so the call ran as a plain "${action}".`,
        ];
        if (spec.accepts.length > 0) {
            lines.push(`"${action}" accepts only: ${spec.accepts.join(", ")}.`);
        } else {
            lines.push(`"${action}" takes no parameters beyond "action".`);
        }
        if (suggestions.length > 0) {
            const best = suggestions[0];
            lines.push(
                `Parameter${unexpected.length === 1 ? "" : "s"} ${unexpected
                    .map((u) => `"${u}"`)
                    .join(", ")} ${unexpected.length === 1 ? "belongs" : "belong"} to action${
                    suggestions.length === 1 ? "" : "s"
                }: ${suggestions.join(", ")}.`,
            );
            lines.push(`Did you mean: ${ACTION_SPECS[best].signature} ?`);
        }
        lines.push(`"${action}" signature: ${spec.signature}`);
        return { kind: "unexpected-param", action, message: lines.join("\n"), unexpected, suggestions };
    }

    // 2. Reject missing required parameters, with the signature to fix it.
    const missing = spec.required.filter((group) => group.params.every((p) => isBlank(record[p])));
    if (missing.length > 0) {
        const lines = [
            `Error: action "${action}" is missing required parameter${missing.length === 1 ? "" : "s"}: ${missing
                .map((m) => m.label)
                .join(", ")}.`,
            `Signature: ${spec.signature}`,
        ];
        // Only actions that address a task by uuid benefit from being told how
        // to look one up; for `create` that tip would be noise.
        if (spec.accepts.includes("uuid") || spec.accepts.includes("id")) {
            lines.push(
                `Tip: find a task's uuid with tasks(action="list") or tasks(action="search", name="<partial title>").`,
            );
        }
        return { kind: "missing-required", action, message: lines.join("\n") };
    }

    return null;
}

/**
 * Short "next step" hint appended to empty or not-found results.
 *
 * A tool that returns an empty list without guidance invites the model to
 * retry the same call; naming the action that would change state breaks that
 * loop. Returns `null` when no hint applies.
 */
export function emptyResultHint(action: TasksAction): string | null {
    switch (action) {
        case "list":
            return 'No tasks yet. Create one with tasks(action="create", title="<task title>").';
        case "search":
            return 'No match. Check the exact title with tasks(action="list"), or create it with tasks(action="create", title="<task title>").';
        case "get":
        case "append":
        case "move":
        case "rename":
        case "delete":
            return 'Find the correct uuid with tasks(action="list") — it is the 8-char id shown after each task title.';
        default:
            return null;
    }
}

/**
 * Every parameter name any action accepts, excluding `action` itself.
 *
 * Derived from {@link ACTION_SPECS} rather than hardcoded, so a test can
 * assert the TypeBox schema below exposes exactly this set — catching drift
 * between what the model is told and what the tool enforces.
 */
export const ALL_TASKS_PARAMS: string[] = [
    ...new Set(Object.values(ACTION_SPECS).flatMap((spec) => spec.accepts)),
].sort();

/**
 * Model-facing parameter schema for the `tasks` tool.
 *
 * Deliberately a **flat object** rather than a `oneOf` discriminated union:
 * Pi performs no runtime validation against this schema, so a union would
 * only change what the model sees — and flat schemas are more reliably
 * filled in by weaker models. Per-action correctness is enforced at runtime
 * by {@link validateTasksParams}, which returns a corrective message instead
 * of relying on schema-level rejection.
 *
 * Each description names the actions that use the parameter, so a model
 * reading the schema can see the coupling without a round trip.
 */
export const TasksParamsSchema = Type.Object({
    action: Type.Union(
        TASKS_ACTIONS.map((a) => Type.Literal(a)),
        {
            description:
                "REQUIRED. Selects the operation; every other parameter is only valid for specific actions and is rejected otherwise. " +
                "Signatures: list(includeClosed?) | create(title, priority?, content?) | get(uuid) | append(uuid, content|file) | " +
                'move(uuid, folder) | rename(uuid, newTitle) | delete(uuid) | search(name) | submit-qa(uuid?, message?).',
        },
    ),
    name: Type.Optional(Type.String({ description: "search only: task title to find (partial match supported)" })),
    folder: Type.Optional(Type.String({ description: 'move only: target folder — "Backlog", "Active" or "Closed"' })),
    content: Type.Optional(Type.String({ description: "create (optional initial notes) and append (required unless file is given)" })),
    file: Type.Optional(Type.String({ description: "append only: path to read content from, for large content (alternative to content)" })),
    newTitle: Type.Optional(Type.String({ description: "rename only: the new title" })),
    title: Type.Optional(Type.String({ description: "create only: task title (required for create). NOT used by list or search." })),
    priority: Type.Optional(
        Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("critical")], {
            description: "create only: task priority, defaults to medium",
        }),
    ),
    includeClosed: Type.Optional(
        Type.Boolean({ description: "list only: include the Closed folder (default false)" }),
    ),
    message: Type.Optional(Type.String({ description: "submit-qa only: note for the QA reviewer" })),
    uuid: Type.Optional(
        Type.String({ description: "get, append, move, rename, delete, submit-qa: task uuid (the 8-char id from list)" }),
    ),
    id: Type.Optional(Type.String({ description: "alias for uuid, accepted by the same actions" })),
});

/** Typed shape of a `tasks` tool call. */
export type TasksParams = Static<typeof TasksParamsSchema>;
