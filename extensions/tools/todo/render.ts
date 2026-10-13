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
	type TodoStatus,
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

interface TreeRow {
	text: string;
	/** Task status when this row is a task; undefined for the trailing summary. */
	status?: TodoStatus;
}

interface TreeLineOptions {
	items: TodoItem[];
	/** Trailing muted summary row; empty string renders none (omp contract). */
	trailingSummary?: string;
	renderItem: (item: TodoItem) => string;
	theme: Theme;
}

function renderTreeLines({ items, trailingSummary: summary, renderItem, theme }: TreeLineOptions): TreeRow[] {
	const rows: TreeRow[] = [];
	for (let i = 0; i < items.length; i++) {
		const rendered = renderItem(items[i]);
		if (!rendered) continue;
		const isLast = summary === "" && i === items.length - 1;
		const prefix = `${theme.fg("dim", isLast ? TREE_LAST : TREE_BRANCH)} `;
		rows.push({ text: `${prefix}${rendered}`, status: items[i].status });
	}
	if (summary !== undefined && summary !== "") {
		rows.push({ text: `${theme.fg("dim", TREE_LAST)} ${theme.fg("muted", summary)}` });
	}
	return rows;
}

// =============================================================================
// Persistent widget
// =============================================================================

/** One row of the widget body (everything below the pinned header). */
interface WidgetRow {
	text: string;
	/** Index into the visible phase list this row belongs to. */
	phaseIndex: number;
	/** Phase header row (as opposed to a task or summary row). */
	header: boolean;
	/** Task status for task rows; undefined for headers and summaries. */
	status?: TodoStatus;
}

/** The first row the viewport keeps in view: the active task, else the first
 *  open one, else the tail of the list. */
function findFocusRow(rows: readonly WidgetRow[]): number {
	if (rows.length === 0) return 0;
	const active = rows.findIndex((row) => row.status === "in_progress");
	if (active !== -1) return active;
	const open = rows.findIndex((row) => row.status === "pending" || row.status === "blocked");
	if (open !== -1) return open;
	return rows.length - 1;
}

/** Index of the phase header owning the row at `focus`. */
function findPhaseHeaderRow(rows: readonly WidgetRow[], focus: number): number {
	const { phaseIndex } = rows[focus];
	for (let i = focus; i >= 0; i--) {
		if (rows[i].header && rows[i].phaseIndex === phaseIndex) return i;
	}
	return focus;
}

interface WidgetViewport {
	start: number;
	size: number;
	hiddenAbove: number;
	hiddenBelow: number;
}

/**
 * Slide a `budget`-line viewport over the body so the focus row stays visible.
 * The phase header leads when it fits with the focus; otherwise the focus
 * leads. Rows scrolled off either edge are replaced by one muted `… +N` line
 * each, so the window shrinks once an indicator appears — the fixed-point loop
 * settles that in a couple of passes.
 */
function computeViewport(bodyLength: number, budget: number, focus: number, headerRow: number): WidgetViewport {
	const startFor = (size: number): number => {
		const maxStart = Math.max(0, bodyLength - size);
		// Anchor on the phase header only while the focus row still fits below it.
		const anchor = focus - headerRow < size ? headerRow : focus;
		return Math.max(0, Math.min(anchor, maxStart));
	};

	let size = Math.min(budget, bodyLength);
	let start = 0;
	let hiddenAbove = 0;
	let hiddenBelow = 0;
	for (let pass = 0; pass < 4; pass++) {
		const indicators = (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0);
		const nextSize = Math.max(1, budget - indicators);
		const nextStart = startFor(nextSize);
		const nextAbove = nextStart;
		const nextBelow = bodyLength - nextStart - nextSize;
		const stable = nextSize === size && nextAbove === hiddenAbove && nextBelow === hiddenBelow;
		size = nextSize;
		start = nextStart;
		hiddenAbove = nextAbove;
		hiddenBelow = nextBelow;
		if (stable) break;
	}
	return { start, size, hiddenAbove, hiddenBelow };
}

/**
 * Render the persistent widget lines, or `[]` when there is nothing to show.
 *
 * Each phase gets a header plus its collapsed walking viewport (last closed
 * task, then active work, then following pending tasks) so a long list stays
 * bounded. The whole widget is capped at `maxLines` — the host truncates at 10
 * anyway. The `[x] Todo · closed/total done` header is pinned to the top; the
 * body below it is a viewport that follows the current work, so completed
 * phases scroll off under a muted `… +N above` marker instead of burying the
 * open tasks behind a `… +N more` footer.
 */
export function renderTodoWidget(phases: readonly TodoPhase[], theme: Theme, maxLines = WIDGET_MAX_LINES): string[] {
	const visible = phases.filter((phase) => phase.tasks.length > 0);
	if (visible.length === 0) return [];

	const total = visible.reduce((sum, phase) => sum + phase.tasks.length, 0);
	const closed = visible.reduce((sum, phase) => sum + phase.tasks.filter(isClosedTodo).length, 0);
	const header = `${theme.fg("accent", CHECKBOX.checked)} ${theme.fg("accent", theme.bold("Todo"))} ${theme.fg("dim", `· ${closed}/${total} done`)}`;

	const multiPhase = visible.length > 1;
	const body: WidgetRow[] = [];
	for (let index = 0; index < visible.length; index++) {
		const phase = visible[index];
		const name = theme.fg("accent", theme.bold(formatPhaseDisplayName(phase.name, index + 1)));
		body.push({ text: `${name}${formatPhaseProgress(phase, theme)}`, phaseIndex: index, header: true });
		const selection = selectCollapsedTodos(phase.tasks, WIDGET_PHASE_CAP);
		const tree = renderTreeLines({
			items: selection.items,
			trailingSummary: selection.summary,
			renderItem: (todo) => formatTodoLine(todo, theme),
			theme,
		});
		for (const row of tree) {
			body.push({
				text: `${multiPhase ? "  " : ""}${row.text}`,
				phaseIndex: index,
				header: false,
				status: row.status,
			});
		}
	}

	const budget = Math.max(1, maxLines - 1);
	if (body.length <= budget) return [header, ...body.map((row) => row.text)];

	const focus = findFocusRow(body);
	const viewport = computeViewport(body.length, budget, focus, findPhaseHeaderRow(body, focus));
	const lines = [header];
	if (viewport.hiddenAbove > 0) lines.push(theme.fg("muted", `… +${viewport.hiddenAbove} above`));
	for (let i = viewport.start; i < viewport.start + viewport.size; i++) lines.push(body[i].text);
	if (viewport.hiddenBelow > 0) lines.push(theme.fg("muted", `… +${viewport.hiddenBelow} more`));
	return lines;
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
