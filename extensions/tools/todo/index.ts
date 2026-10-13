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
 * statuses change only through explicit ops. The upkeep guidance is back as a
 * `todo_upkeep` system-prompt section, appended per run only where `todo` is
 * callable (see the `before_agent_start` handler below).
 *
 * Integration contract for other extensions:
 *   - `pi.events.emit("todo_updated", { phases })` after every successful
 *     mutation (never on view or failure); full snapshot, five-status enum
 *   - every mutation appends a "todo-phases" snapshot entry (pi-goal's
 *     todo bridge and restore both read it)
 *
 * Rendering: the list is shown as a persistent widget above the prompt editor
 * (updated on every commit and restored on session start). Each `todo` call
 * renders as a compact dim row in the transcript, its outcome (or the full
 * error) beneath it — see tool.ts. An unfinished list persists across runs
 * (live progress state); a finished list auto-clears at the mutation that
 * finishes it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createTodoCommand } from "./commands.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { TODO_UPKEEP_SECTION } from "../../../shared/prompt-sections.ts";
import { renderTodoWidget, TodoWidget } from "./render.ts";
import { clonePhases, isFinishedTodoList, type TodoPhase } from "./state.ts";
import { createTodoTool } from "./tool.ts";
import { TODO_PHASES_ENTRY_TYPE, restorePhasesFromEntries } from "./restore.ts";

/** Widget slot key (one per extension; also used to clear it). */
const TODO_WIDGET_KEY = "todo";

/**
 * The todo list is live progress state, not a plan written once. This reinstates
 * prompt-level steering that the cognitive-neutral refactor removed (the tool
 * description documented the mechanics and the system prompt stayed silent).
 */
const TODO_UPKEEP = [
	"# Todo upkeep",
	"",
	"The todo list is live progress state, not a plan you write once. Keep it true as you work:",
	"",
	'- Call `todo` with `op: "start"` on an item before you begin it, so at most one item is `in_progress` at a time.',
	'- The moment an item is finished, call `todo` with `op: "done"` and that item\'s exact `task` string — in the same turn as the work, before starting the next item.',
	"- Never leave a finished item marked `pending` or `in_progress`, and never mark an item done that you did not actually complete.",
	"- When every item is done, say so; the list is the record of what actually happened.",
].join("\n");

export default function piTodoExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("todo");
	let phases: TodoPhase[] = [];
	let ctx: ExtensionContext | undefined;
	let widgetTui: TUI | undefined;
	let widgetRegistered = false;

	/**
	 * Push the current list into the persistent widget.
	 *
	 * The widget is a component factory registered once per session: subsequent
	 * changes only ask the host to re-render the existing component, which reads
	 * the live `phases` and theme. Replacing the widget on every change (the
	 * string-array form) rebuilds the component tree instead.
	 */
	const renderWidget = () => {
		if (!ctx?.hasUI) return;
		const hasContent = phases.some((phase) => phase.tasks.length > 0);

		// Non-TUI hosts (RPC) only support the string-array widget form.
		if (ctx.mode !== "tui") {
			const lines = hasContent ? renderTodoWidget(phases, ctx.ui.theme) : undefined;
			ctx.ui.setWidget(TODO_WIDGET_KEY, lines, { placement: "aboveEditor" });
			return;
		}

		if (!hasContent) {
			if (widgetRegistered) {
				ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
				widgetRegistered = false;
				widgetTui = undefined;
			}
			return;
		}
		if (widgetRegistered) {
			widgetTui?.requestRender();
			return;
		}
		ctx.ui.setWidget(
			TODO_WIDGET_KEY,
			(tui) => {
				widgetTui = tui;
				return new TodoWidget(() => phases, () => ctx!.ui.theme);
			},
			{ placement: "aboveEditor" },
		);
		widgetRegistered = true;
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
			renderWidget();
		},
	};

	pi.registerTool(createTodoTool(deps));

	pi.registerCommand("todo", {
		description: "View or modify the agent's todo list",
		handler: createTodoCommand(deps),
	});

	// Append the upkeep guidance to every run where `todo` is actually callable.
	// The active tool set is authoritative in every submode: Straight whitelists
	// `todo` (so it gets the guidance), Plan/Grill narrow it out (so it does not).
	// The submode re-assert handler runs before this one — submodes loads before
	// todo in the manifest globs.
	pi.on("before_agent_start", (event) => {
		const { sections } = event.systemPromptOptions;
		delete sections[TODO_UPKEEP_SECTION];
		if (!pi.getActiveTools().includes("todo")) return;
		sections[TODO_UPKEEP_SECTION] = TODO_UPKEEP;
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
		widgetTui = undefined;
		widgetRegistered = false;
	});
}
