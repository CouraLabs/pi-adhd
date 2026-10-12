/**
 * pi-todo — the oh-my-pi todo tool migrated to a pi extension.
 *
 * Source: oh-my-pi (github.com/can1357/oh-my-pi, a fork of badlogic/pi-mono)
 *   - packages/coding-agent/src/tools/todo.ts (state + ops) → state.ts
 *   - packages/coding-agent/src/tools/todo.ts (TodoTool)     → tool.ts
 *   - packages/coding-agent/src/tools/todo.ts (renderer)     → render.ts
 *   - packages/coding-agent/src/prompts/tools/todo.md        → prompts/todo.md
 *   - packages/coding-agent/src/modes/controllers/todo-command-controller.ts
 *                                                            → commands.ts
 *
 * Adaptations for pi's extension API (each maps an omp-internal surface to
 * the public extension boundary):
 *
 *   omp surface                       → pi adaptation
 *   ─────────────────────────────────────────────────────────────────────────
 *   session getTodoPhases/setTodoPhases → closure state + pi.appendEntry
 *                                         full-snapshot entries ("todo-phases")
 *   restore via tool-result details     → session_start backward scan of the
 *                                         current branch (appendEntry chains
 *                                         off the leaf, so tree navigation
 *                                         and forks restore branch-local state)
 *   ArkType schema + lenientArgValidation
 *                                     → TypeBox schema + prepareArguments
 *                                         (missing-op inference before validation)
 *   concurrency: "exclusive"           → executionMode: "sequential"
 *   mergeCallAndResult renderer        → split renderCall/renderResult slots
 *
 * Removed in the cognitive-neutral refactor (agent-steering logic, not
 * bookkeeping): eager-todo promptGuidelines, the stop-reminder nag loop
 * (checkCompletion / TodoReminderComponent), and the manual-edit
 * `<system-reminder>` injection. The todo list is a neutral stateful notepad:
 * statuses change only through explicit ops.
 *
 * Integration contract for other extensions:
 *   - `pi.events.emit("todo_updated", { phases })` after every successful
 *     mutation (never on view or failure); full snapshot, five-status enum
 *   - every mutation appends a "todo-phases" snapshot entry (pi-goal's
 *     todo bridge and restore both read it)
 *
 * Rendering: the list is shown as a persistent widget above the prompt editor
 * (updated on every commit and restored on session start); the `todo` tool call
 * itself is hidden from the transcript (see tool.ts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createTodoCommand } from "./commands.ts";
import { renderTodoWidget } from "./render.ts";
import { clonePhases, isFinishedTodoList, type TodoPhase } from "./state.ts";
import { commitPhases, createTodoTool } from "./tool.ts";
import { TODO_PHASES_ENTRY_TYPE, restorePhasesFromEntries } from "./restore.ts";

/** Widget slot key (one per extension; also used to clear it). */
const TODO_WIDGET_KEY = "todo";

export default function piTodoExtension(pi: ExtensionAPI): void {
	let phases: TodoPhase[] = [];
	let ctx: ExtensionContext | undefined;

	const renderWidget = () => {
		if (!ctx?.hasUI) return;
		const lines = renderTodoWidget(phases, ctx.ui.theme);
		ctx.ui.setWidget(TODO_WIDGET_KEY, lines.length > 0 ? lines : undefined, { placement: "aboveEditor" });
	};

	const deps = {
		getPhases: () => phases,
		setPhases: (next: TodoPhase[]) => {
			phases = next;
			renderWidget();
		},
		persist: (next: TodoPhase[]) => {
			pi.appendEntry(TODO_PHASES_ENTRY_TYPE, { phases: clonePhases(next) });
		},
		broadcast: (next: TodoPhase[]) => {
			pi.events.emit("todo_updated", { phases: clonePhases(next) });
		},
	};

	pi.registerTool(createTodoTool(deps));

	pi.registerCommand("todo", {
		description: "View or modify the agent's todo list",
		handler: createTodoCommand(deps),
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		// Branch-aware restore: latest valid snapshot on the current branch wins.
		// getBranch() excludes entries on abandoned branches created after a
		// /fork or /tree navigation; getEntries() would let a later snapshot
		// from an abandoned branch win the backward scan.
		const restored = restorePhasesFromEntries(context.sessionManager.getBranch());
		// Normalize here as well as on commit: a finished list (e.g. completed
		// before the auto-clear existed, replayed by /reload) must not resurrect
		// the widget on restore.
		phases = isFinishedTodoList(restored) ? [] : restored;
		renderWidget();
	});

	pi.on("session_shutdown", (_event, context) => {
		if (context.hasUI) context.ui.setWidget(TODO_WIDGET_KEY, undefined);
		ctx = undefined;
	});

	// A final assistant reply (no tool calls) ends the turn. Any leftover,
	// unfinished list is discarded so the widget does not linger between
	// requests; intermediate tool-call turns keep the list, and a finished list
	// has already been auto-cleared by commitPhases.
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.content.some((block) => block.type === "toolCall")) return;
		if (phases.length === 0) return;
		commitPhases(deps, []);
	});
}
