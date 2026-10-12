/**
 * pi-todo — tool definition.
 *
 * Ported from oh-my-pi `packages/coding-agent/src/tools/todo.ts` (TodoTool).
 * Adaptations for pi's extension API:
 *   ArkType schema + lenientArgValidation + resolveTodoParams repair
 *     → TypeBox schema + prepareArguments shim (op inference runs before
 *       schema validation; the closure supplies `hasExistingPhases`)
 *   AgentTool class + ToolSession  → ToolDefinition + closure deps
 *   concurrency: "exclusive"      → executionMode: "sequential"
 *   session getTodoPhases/setTodoPhases → getPhases/setPhases/persist/broadcast
 *   eager-todo promptGuidelines    → dropped (cognitive-neutral notepad: the
 *       tool description documents the mechanics; the system prompt is not
 *       steered)
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme, ToolDefinition, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
	applyParams,
	clonePhases,
	formatSummary,
	getStatusTransitions,
	inferTodoOp,
	isClosedTodo,
	isFinishedTodoList,
	type TodoOperation,
	type TodoOpEntry,
	type TodoPhase,
	type TodoStatusTransition,
	type TodoToolDetails,
} from "./state.ts";

// Prompt lives in a static .md asset next to this module (published with the
// package). Loaded at runtime: pi loads extensions through jiti, which does
// not support bundler-style text imports (pi-dynamic-workflows precedent).
const todoDescription = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "todo.md"),
	"utf8",
);

export const TodoParamsSchema = Type.Object({
	op: StringEnum(["init", "start", "done", "rm", "drop", "block", "unblock", "append", "view"] as const, {
		description: "operation to apply",
	}),
	list: Type.Optional(
		Type.Array(
			Type.Object({
				phase: Type.String({ description: "phase name" }),
				items: Type.Array(Type.String({ description: "task content" }), {
					minItems: 1,
					description: "tasks for this phase",
				}),
			}),
			{ description: "phased task list (init)" },
		),
	),
	task: Type.Optional(Type.String({ description: "task content" })),
	phase: Type.Optional(Type.String({ description: "phase name" })),
	// No minItems here: `items` is only meaningful for `init`/`append`, and both
	// enforce non-empty with op-specific errors. A stray `items: []` on an op
	// that ignores it (e.g. `view`) must not be a hard schema rejection.
	items: Type.Optional(Type.Array(Type.String({ description: "task content" }), { description: "tasks to append" })),
	reason: Type.Optional(Type.String({ description: "blocker note (block op)" })),
});

export type TodoParams = Static<typeof TodoParamsSchema>;

export interface TodoToolDeps {
	/** Current in-memory phases (already cloned on write). */
	getPhases(): TodoPhase[];
	/** Replace in-memory phases. */
	setPhases(phases: TodoPhase[]): void;
	/** Persist a full snapshot to the session. */
	persist(phases: TodoPhase[]): void;
	/** Broadcast a todo_updated event on the shared extension event bus. */
	broadcast(phases: TodoPhase[]): void;
}

/** The one write-back invariant: replace state, persist, broadcast — in that
 *  order. Shared by the tool path and the /todo command path so the two can
 *  never drift (persist/broadcast semantics live in index.ts's deps).
 *
 *  A finished list commits as empty: the persistent widget hides and nothing
 *  is left to restore. */
export function commitPhases(deps: TodoToolDeps, next: TodoPhase[]): void {
	const committed = isFinishedTodoList(next) ? [] : next;
	deps.setPhases(committed);
	deps.persist(committed);
	deps.broadcast(committed);
}

/** Compact transcript rows: one dim line per call, one line for the outcome.
 *  The widget above the editor remains the persistent list view; these rows
 *  make each todo call — including failed ones — visible in the transcript. */

const CALL_LINE_MAX = 100;
const RESULT_LINE_CAP = 8;

function clip(text: string): string {
	const single = text.replace(/[\t\n\r]+/g, " ");
	return single.length > CALL_LINE_MAX ? `${single.slice(0, CALL_LINE_MAX - 1)}…` : single;
}

function quoteTask(task: string | undefined): string {
	return task ? ` "${clip(task)}"` : "";
}

/** One-line summary of the raw call args. Defensive: args may be unprepared or
 *  invalid at render time (renderCall also runs for rejected calls). */
function callLine(args: unknown): string {
	const raw = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
	const op = typeof raw.op === "string" ? raw.op : undefined;
	const task = typeof raw.task === "string" ? raw.task : undefined;
	const phase = typeof raw.phase === "string" ? raw.phase : undefined;
	const reason = typeof raw.reason === "string" ? raw.reason : undefined;
	const count = (key: string): number => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).length : 0);
	switch (op) {
		case "init": {
			const list = Array.isArray(raw.list) ? (raw.list as unknown[]) : undefined;
			if (list && list.length > 0) {
				const tasks = list.reduce<number>((sum, entry) => {
					const items =
						entry && typeof entry === "object" && Array.isArray((entry as { items?: unknown }).items)
							? (entry as { items: unknown[] }).items.length
							: 0;
					return sum + items;
				}, 0);
				return `init · ${list.length} phase${list.length === 1 ? "" : "s"}, ${tasks} task${tasks === 1 ? "" : "s"}`;
			}
			const items = count("items");
			return `init · ${items} task${items === 1 ? "" : "s"}`;
		}
		case "append":
			return `append · ${phase ?? "?"} +${count("items")}`;
		case "start":
			return `start ·${quoteTask(task)}`;
		case "done":
		case "drop":
			return task ? `${op} ·${quoteTask(task)}` : phase ? `${op} · phase "${clip(phase)}"` : `${op} · all`;
		case "block":
			return `block ·${quoteTask(task)}${reason ? ` (${clip(reason)})` : ""}`;
		case "unblock":
			return `unblock ·${quoteTask(task)}`;
		case "rm":
			return task ? `rm ·${quoteTask(task)}` : phase ? `rm · phase "${clip(phase)}"` : "rm · all";
		case "view":
			return "view";
		default:
			return `todo ${clip(JSON.stringify(raw))}`;
	}
}

/** One-line summary of the outcome, computed in execute() where the op, the
 *  params, and the status transitions are all known. */
function resultLine(
	op: TodoOperation,
	params: TodoParams,
	transitions: TodoStatusTransition[],
	phases: TodoPhase[],
): string {
	const tasks = phases.flatMap(phase => phase.tasks);
	const closed = tasks.filter(isClosedTodo).length;
	const total = tasks.length;
	switch (op) {
		case "init":
			return `init · ${phases.length} phase${phases.length === 1 ? "" : "s"}, ${total} task${total === 1 ? "" : "s"}`;
		case "append":
			return `append · ${params.phase ?? "?"} +${params.items?.length ?? 0}`;
		case "view":
			return total === 0 ? "view · empty list" : `view · ${closed}/${total} done, ${total - closed} open`;
		case "rm":
			return params.task
				? `rm · "${clip(params.task)}"`
				: params.phase
					? `rm · phase "${clip(params.phase)}"`
					: "rm · all";
		default: {
			if (transitions.length === 0) return `${op} · no changes`;
			const first = transitions
				.slice(0, 3)
				.map(transition => `"${clip(transition.content)}" ${transition.from} → ${transition.to}`)
				.join("; ");
			return `${op} · ${first}${transitions.length > 3 ? ` (+${transitions.length - 3} more)` : ""}`;
		}
	}
}

/** Model-facing result text (thrown todo errors put their message there too). */
function resultText(result: AgentToolResult<TodoToolDetails>): string {
	return (
		result.content
			.map(block => (block.type === "text" ? block.text : ""))
			.join("\n")
			.trim() || "todo call failed"
	);
}

function renderTodoCall(args: unknown, theme: Theme): Text {
	return new Text(theme.fg("dim", callLine(args)), 0, 0);
}

function renderTodoResult(
	result: AgentToolResult<TodoToolDetails>,
	_options: ToolRenderResultOptions,
	theme: Theme,
	context: { isError: boolean },
): Text {
	if (context.isError) {
		// Thrown/failed call: pi's error result carries the message (and for todo
		// errors the unchanged list) in content. Surface it — this is where a
		// silent failure used to disappear into an empty render.
		const lines = resultText(result).split("\n");
		const shown = lines.slice(0, RESULT_LINE_CAP).join("\n");
		const more = lines.length > RESULT_LINE_CAP ? `\n… +${lines.length - RESULT_LINE_CAP} more` : "";
		return new Text(theme.fg("error", `✗ ${shown}${more}`), 0, 0);
	}
	const line = (result.details as TodoToolDetails | undefined)?.line;
	if (typeof line === "string") {
		return new Text(theme.fg("success", `✓ ${line}`), 0, 0);
	}
	// Entries predating details.line (restored from older sessions): render the
	// summary's first line rather than misreading success as failure.
	const first = resultText(result).split("\n")[0] ?? "";
	return new Text(theme.fg("dim", first ? `✓ ${clip(first)}` : "✓ todo"), 0, 0);
}

export function createTodoTool(deps: TodoToolDeps): ToolDefinition<typeof TodoParamsSchema, TodoToolDetails> {
	const definition: ToolDefinition<typeof TodoParamsSchema, TodoToolDetails> = {
		name: "todo",
		label: "Todo",
		description: todoDescription,
		parameters: TodoParamsSchema,
		executionMode: "sequential",
		// The todo list renders as a persistent widget above the editor (see
		// index.ts), so the transcript shows only a compact row per call: one dim
		// line for the call, one for the outcome. Failures render in full (error
		// color) — a failed call must never disappear into an empty render.
		renderShell: "self",
		renderCall: renderTodoCall,
		renderResult: renderTodoResult,

		prepareArguments(args: unknown): TodoParams {
			// Repair the one recoverable shape: a missing `op` alongside an
			// unambiguous payload (models routinely send `{list:[...]}` with no op).
			if (args && typeof args === "object" && !Array.isArray(args)) {
				const raw = args as Record<string, unknown>;
				if (raw.op === undefined) {
					const inferred = inferTodoOp(raw, deps.getPhases().length > 0);
					if (inferred) return { ...raw, op: inferred } as TodoParams;
				}
			}
			return args as TodoParams;
		},

		async execute(
			_toolCallId: string,
			params: TodoParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<TodoToolDetails>> {
			const previousPhases = deps.getPhases();
			const op: TodoOperation = params.op;
			// Pure-view calls are reads: no normalization, no state write.
			const readOnly = op === "view";
			const { phases: updated, errors } = readOnly
				? { phases: previousPhases, errors: [] as string[] }
				: applyParams(clonePhases(previousPhases), params as TodoOpEntry);
			// A batch with any error is discarded wholesale: persisting a
			// half-applied batch makes the natural retry hit "already exists" for
			// the ops that did land. State stays at previous. pi's tool contract
			// is throw-on-failure (no isError field on AgentToolResult), and the
			// thrown message carries the errors plus the unchanged list so the
			// model can retry with correct content. formatSummary does not fold
			// error results (the fold is gated on empty errors), so the full list
			// is present even on big lists.
			if (errors.length > 0) {
				throw new Error(formatSummary(previousPhases, errors, readOnly));
			}
			if (!readOnly) {
				// `updated` is a fresh clone nothing else references: hand ownership
				// to the closure, and let persist/broadcast make their own
				// entry-shaped snapshots (clonePhases inside index.ts).
				commitPhases(deps, updated);
			}
			// Per-write confirmation, independent of summary folding: on big lists
			// the folded summary may not show the operated tasks at all, so the
			// model needs an explicit record of what changed (status + blocker note).
			const transitions = readOnly ? [] : getStatusTransitions(previousPhases, updated);
			const details: TodoToolDetails = {
				op,
				phases: clonePhases(updated),
				storage: "session",
				line: resultLine(op, params, transitions, updated),
			};
			const completedTasks = transitions
				.filter(transition => transition.to === "completed")
				.map(({ phase, content }) => ({ phase, content }));
			if (completedTasks.length > 0) details.completedTasks = completedTasks;

			let text = formatSummary(updated, [], readOnly);
			if (transitions.length > 0) {
				const changed = transitions
					.map(transition => {
						const blocker =
							transition.to === "blocked"
								? updated
									.find(phase => phase.name === transition.phase)
									?.tasks.find(task => task.content === transition.content)?.blocker
								: undefined;
						const note = blocker ? ` (blocked: ${blocker})` : "";
						return `  - ${transition.content} [${transition.from} → ${transition.to}]${note} (${transition.phase})`;
					})
					.join("\n");
				text = `Changed:\n${changed}\n\n${text}`;
			}

			return {
				content: [{ type: "text", text }],
				details,
			};
		},
	};
	return definition;
}
