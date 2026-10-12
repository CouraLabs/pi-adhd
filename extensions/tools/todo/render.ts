/**
 * pi-todo — persistent widget rendering.
 *
 * The todo list is shown above the prompt editor instead of as transcript
 * tool-call blocks, so the plan stays visible while the agent works. The
 * task/tree formatting is the omp renderer's, reused from the original
 * transcript view:
 *   - header: ☑ Todo · closed/total done
 *   - phase:  <roman>. <name>  done/total
 *   - tasks:  ☑ success strikethrough / ☐ accent in-progress / ☐ error
 *             strikethrough abandoned / ☐ warning blocked (note) / ☐ dim pending
 *   - tree:   ├─ / └─ dim branch glyphs with the muted trailing summary
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { WIDGET_LEFT_PADDING } from "../../../shared/format.ts";
import {
	isClosedTodo,
	phaseRomanNumeral,
	selectCollapsedTodos,
	type TodoItem,
	type TodoPhase,
} from "./state.ts";

/** Display cap: keeps widget lines width-safe without knowing the terminal width. */
const MAX_LINE = 100;

/** Host caps extension widgets at 10 lines; keep our own footer within that. */
const WIDGET_MAX_LINES = 10;

/** Per-phase viewport cap inside the widget (the transcript used 8). */
const WIDGET_PHASE_CAP = 5;

function clip(text: string): string {
	const single = text.replace(/[\t\n\r]+/g, " ");
	return single.length > MAX_LINE ? `${single.slice(0, MAX_LINE - 1)}…` : single;
}

// =============================================================================
// Phase headers (omp formatPhaseDisplayName / formatPhaseProgress)
// =============================================================================

function formatPhaseDisplayName(name: string, oneBasedIndex: number): string {
	return `${phaseRomanNumeral(oneBasedIndex)}. ${clip(name)}`;
}

/** Dim `closed/total` suffix — counts completed + abandoned (omp isClosedTodo). */
function formatPhaseProgress(phase: TodoPhase, theme: Theme): string {
	const done = phase.tasks.filter(isClosedTodo).length;
	return theme.fg("dim", `  ${done}/${phase.tasks.length}`);
}

// =============================================================================
// Task lines (omp formatTodoLine, final strike state)
// =============================================================================

/** omp theme.checkbox unicode set (checkbox.checked / checkbox.unchecked). */
const CHECKBOX = { checked: "[x]", unchecked: "[ ]" } as const;

function formatTodoLine(item: TodoItem, theme: Theme): string {
	const label = clip(item.content);
	const box = CHECKBOX.unchecked;
	switch (item.status) {
		case "completed":
			return theme.fg("success", `${CHECKBOX.checked} ${theme.strikethrough(label)}`);
		case "in_progress":
			return theme.fg("accent", `${box} ${label}`);
		case "abandoned":
			return theme.fg("error", `${box} ${theme.strikethrough(label)}`);
		case "blocked": {
			const note = item.blocker ? `blocked: ${clip(item.blocker)}` : "blocked";
			return theme.fg("warning", `${box} ${label} (${note})`);
		}
		default:
			return theme.fg("dim", `${box} ${label}`);
	}
}

// =============================================================================
// Tree lines (omp renderTreeList trailingSummary branch)
// =============================================================================

const TREE_BRANCH = "├─";
const TREE_LAST = "└─";

interface TreeLineOptions {
	items: TodoItem[];
	/** Trailing muted summary row; empty string renders none (omp contract). */
	trailingSummary?: string;
	renderItem: (item: TodoItem) => string;
	theme: Theme;
}

function renderTreeLines({ items, trailingSummary: summary, renderItem, theme }: TreeLineOptions): string[] {
	const lines: string[] = [];
	for (let i = 0; i < items.length; i++) {
		const rendered = renderItem(items[i]);
		if (!rendered) continue;
		const isLast = summary === "" && i === items.length - 1;
		const prefix = `${theme.fg("dim", isLast ? TREE_LAST : TREE_BRANCH)} `;
		lines.push(`${prefix}${rendered}`);
	}
	if (summary !== undefined && summary !== "") {
		lines.push(`${theme.fg("dim", TREE_LAST)} ${theme.fg("muted", summary)}`);
	}
	return lines;
}

// =============================================================================
// Persistent widget
// =============================================================================

/**
 * Render the persistent widget lines, or `[]` when there is nothing to show.
 *
 * Each phase gets a header plus its collapsed walking viewport (last closed
 * task, then active work, then following pending tasks) so a long list stays
 * bounded. The whole widget is capped at `maxLines` — the host truncates at 10
 * anyway, so we add our own `… +N more` footer instead.
 */
export function renderTodoWidget(phases: readonly TodoPhase[], theme: Theme, maxLines = WIDGET_MAX_LINES): string[] {
	const visible = phases.filter((phase) => phase.tasks.length > 0);
	if (visible.length === 0) return [];

	const total = visible.reduce((sum, phase) => sum + phase.tasks.length, 0);
	const closed = visible.reduce((sum, phase) => sum + phase.tasks.filter(isClosedTodo).length, 0);
	const lines: string[] = [
		`${theme.fg("accent", CHECKBOX.checked)} ${theme.fg("accent", theme.bold("Todo"))} ${theme.fg("dim", `· ${closed}/${total} done`)}`,
	];

	const multiPhase = visible.length > 1;
	for (let index = 0; index < visible.length; index++) {
		const phase = visible[index];
		const name = theme.fg("accent", theme.bold(formatPhaseDisplayName(phase.name, index + 1)));
		lines.push(`${name}${formatPhaseProgress(phase, theme)}`);
		const selection = selectCollapsedTodos(phase.tasks, WIDGET_PHASE_CAP);
		const tree = renderTreeLines({
			items: selection.items,
			trailingSummary: selection.summary,
			renderItem: (todo) => formatTodoLine(todo, theme),
			theme,
		});
		for (const line of tree) lines.push(`${multiPhase ? "  " : ""}${line}`);
	}

	if (lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines - 1);
	kept.push(theme.fg("muted", `… +${lines.length - kept.length} more`));
	return kept;
}

/**
 * Live todo widget component.
 *
 * Registered once per session and re-rendered in place, so the host keeps the
 * component identity stable and the plan updates without rebuilding the widget
 * tree. `render` reads the current phases and theme on every frame; each line
 * goes through `Text` with the shared one-column margin, matching the host's
 * own string-array widget form (which wraps lines in `Text(line, 1, 0)`).
 */
export class TodoWidget implements Component {
	constructor(
		private readonly getPhases: () => readonly TodoPhase[],
		private readonly getTheme: () => Theme,
	) {}

	render(width: number): string[] {
		const lines = renderTodoWidget(this.getPhases(), this.getTheme());
		const out: string[] = [];
		for (const line of lines) {
			out.push(...new Text(line, WIDGET_LEFT_PADDING.length, 0).render(width));
		}
		return out;
	}

	invalidate(): void {
		// Nothing cached: render() reads live state on every frame.
	}
}
