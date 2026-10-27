import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Input,
	type MarkdownTheme,
	type OverlayOptions,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	Markdown,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { clamp, clipIndicator, replaceTabs } from "../../../shared/util.ts";
import { labeledRule } from "../../../shared/labeled-rule.ts";
import { probeTuiMode } from "../../../shared/tui-mode.ts";
import { REVIEW_COMMENT, REVIEW_COMMENT_MARK, REVIEW_CURSOR } from "../../../shared/glyphs.ts";

export type PlanVerdict = "approve" | "approve-compact" | "reject";

export interface PlanLineComment {
	line: number;
	text: string;
}

export interface PlanReviewResult {
	verdict: PlanVerdict;
	comments: PlanLineComment[];
}

interface PlanReviewPaneOptions {
	tui: TUI;
	theme: Theme;
	keys: KeybindingsManager;
	plan: string;
	fullscreen: boolean;
	done: (result: PlanReviewResult | undefined) => void;
}

interface Row {

	line: number;
	text: string;
	kind: "code" | "comment";
}

interface RowsCache {
	width: number;
	rows: Row[];
}

export async function showPlanReview(
	ui: ExtensionUIContext,
	plan: string,
	signal: AbortSignal | undefined,
): Promise<PlanReviewResult | undefined> {
	const mode = await probeTuiMode(ui);
	const fullscreen = mode === "fullscreen";
	const overlayOptions: OverlayOptions = {
		anchor: "center",
		width: "100%",
		maxHeight: "100%",
		margin: 0,
	};
	return ui.custom<PlanReviewResult | undefined>(
		(tui, theme, keys, done) => {
			const pane = new PlanReviewPane({ tui, theme, keys, plan, fullscreen, done });
			signal?.addEventListener("abort", () => pane.cancel(), { once: true });
			return pane;
		},
		fullscreen ? { overlay: true, overlayOptions } : { overlay: false },
	);
}

export class PlanReviewPane implements Component {
	#focused = false;
	get focused(): boolean {
		return this.#focused;
	}
	set focused(value: boolean) {
		this.#focused = value;
		if (this.#editor) this.#editor.input.focused = value;
	}

	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #keys: KeybindingsManager;
	readonly #fullscreen: boolean;
	readonly #done: (result: PlanReviewResult | undefined) => void;
	readonly #sourceLines: string[];
	readonly #comments = new Map<number, string>();

	#cursor = 0;
	#scrollOffset = 0;
	#cache: RowsCache | undefined;
	#markdownTheme: MarkdownTheme | undefined;
	#editor: { input: Input; line: number } | undefined;
	#closed = false;

	constructor({ tui, theme, keys, plan, fullscreen, done }: PlanReviewPaneOptions) {
		this.#tui = tui;
		this.#theme = theme;
		this.#keys = keys;
		this.#fullscreen = fullscreen;
		this.#done = done;
		this.#sourceLines = plan.replace(/\r\n?/g, "\n").split("\n");
	}

	invalidate(): void {
		this.#cache = undefined;
	}

	dispose(): void {
		this.#closed = true;
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (this.#editor) {
			this.#editor.input.handleInput(data);
			return;
		}
		const total = this.#sourceLines.length;
		if (matchesKey(data, "escape")) {
			this.#finish("reject");
			return;
		}
		if (matchesKey(data, "1") || matchesKey(data, "a")) {
			this.#finish("approve");
			return;
		}
		if (matchesKey(data, "2")) {
			this.#finish("approve-compact");
			return;
		}
		if (matchesKey(data, "3") || matchesKey(data, "r")) {
			this.#finish("reject");
			return;
		}
		if (matchesKey(data, "c")) {
			this.#openEditor();
			return;
		}
		if (matchesKey(data, "d")) {
			this.#comments.delete(this.#cursor);
			this.invalidate();
			this.#requestRender();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.#move(-1);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.#move(1);
			return;
		}
		if (
			this.#keys.matches(data, "tui.altScreen.pageUp") ||
			matchesKey(data, "pageUp") ||
			matchesKey(data, "shift+up")
		) {
			this.#move(-this.#pageSize());
			return;
		}
		if (
			this.#keys.matches(data, "tui.altScreen.pageDown") ||
			matchesKey(data, "pageDown") ||
			matchesKey(data, "shift+down")
		) {
			this.#move(this.#pageSize());
			return;
		}
		if (this.#keys.matches(data, "tui.altScreen.top") || matchesKey(data, "home")) {
			this.#cursor = 0;
			this.#requestRender();
			return;
		}
		if (this.#keys.matches(data, "tui.altScreen.bottom") || matchesKey(data, "end")) {
			this.#cursor = Math.max(0, total - 1);
			this.#requestRender();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		this.#move(event.wheelDelta ?? 0);
		return { handled: true };
	}

	render(width: number): string[] {
		if (width < 10) return [];
		const theme = this.#theme;
		const paint = (rule: string) => theme.fg("border", rule);
		const total = this.#sourceLines.length;
		this.#cursor = clamp(this.#cursor, 0, Math.max(0, total - 1));

		const rows = this.#buildRows(width);
		const editorRows = this.#editor ? 2 : 0;
		const viewportHeight = this.#viewportHeight(rows.length, editorRows);
		this.#scrollOffset = this.#scrollOffsetFor(rows, viewportHeight);
		const visible = rows.slice(this.#scrollOffset, this.#scrollOffset + viewportHeight);
		while (visible.length < viewportHeight) visible.push({ line: -1, text: "", kind: "code" });

		const gutterWidth = this.#gutterWidth();
		const lineNoWidth = String(Math.max(1, total)).length;
		const body = visible.map((row) => this.#renderRow(row, width, gutterWidth, lineNoWidth));

		const header = labeledRule(
			width,
			paint,
			[theme.bold(theme.fg("accent", "Plan review"))],
			[theme.fg("dim", `${total} lines · ${this.#comments.size} comments`)],
		);
		const footer = this.#editor
			? [this.#renderEditor(width), truncateToWidth(theme.fg("dim", "  Enter save · Esc cancel"), width)]
			: [
					labeledRule(
						width,
						paint,
						[theme.fg("dim", this.#footerHints())],
						this.#scrollIndicator(rows.length, viewportHeight),
					),
				];
		return [header, ...body, ...footer];
	}

	cancel(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#done(undefined);
	}

	#requestRender(): void {
		this.#tui.requestRender();
	}

	#markdown(): MarkdownTheme {
		if (!this.#markdownTheme) this.#markdownTheme = getMarkdownTheme();
		return this.#markdownTheme;
	}

	#gutterWidth(): number {
		const lineNoWidth = String(Math.max(1, this.#sourceLines.length)).length;
		return 2 + lineNoWidth + 1 + 2 + 1;
	}

	#buildRows(width: number): Row[] {
		if (this.#cache?.width === width) return this.#cache.rows;
		const theme = this.#theme;
		const gutterWidth = this.#gutterWidth();
		const contentWidth = Math.max(1, width - gutterWidth);
		const mdTheme = this.#markdown();
		const rows: Row[] = [];
		let inFence = false;
		for (let i = 0; i < this.#sourceLines.length; i++) {
			const raw = replaceTabs(this.#sourceLines[i] ?? "");
			if (/^\s*(```|~~~)/.test(raw)) {
				inFence = !inFence;
				rows.push({ line: i, text: theme.fg("dim", raw), kind: "code" });
			} else if (inFence) {
				const wrapped = raw === "" ? [""] : wrapTextWithAnsi(theme.fg("mdCodeBlock", raw), contentWidth);
				for (const segment of wrapped) rows.push({ line: i, text: segment, kind: "code" });
			} else if (raw.trim() === "") {
				rows.push({ line: i, text: "", kind: "code" });
			} else {
				const markdown = new Markdown(raw, 0, 0, mdTheme);
				for (const segment of markdown.render(contentWidth)) rows.push({ line: i, text: segment, kind: "code" });
			}
			const comment = this.#comments.get(i);
			if (comment) {
				const wrapped = wrapTextWithAnsi(comment, Math.max(1, contentWidth - 3));
				for (const segment of wrapped) rows.push({ line: i, text: segment, kind: "comment" });
			}
		}
		this.#cache = { width, rows };
		return rows;
	}

	#renderRow(row: Row, width: number, gutterWidth: number, lineNoWidth: number): string {
		const theme = this.#theme;
		if (row.line < 0) return "";
		if (row.kind === "comment") {
			const prefix = " ".repeat(gutterWidth) + theme.fg("warning", `${REVIEW_COMMENT} `);
			return truncateToWidth(prefix + theme.fg("warning", row.text), width);
		}
		const selected = row.line === this.#cursor;
		const cursorMark = selected ? theme.fg("accent", `${REVIEW_CURSOR} `) : "  ";
		const number = (row.line + 1).toString().padStart(lineNoWidth);
		const numberStyled = selected ? theme.fg("accent", number) : theme.fg("dim", number);
		const marker = this.#comments.has(row.line) ? theme.fg("warning", REVIEW_COMMENT_MARK) : " ";
		const gutter = `${cursorMark}${numberStyled} ${marker} `;
		return truncateToWidth(gutter + row.text, width);
	}

	#renderEditor(width: number): string {
		const editor = this.#editor;
		if (!editor) return "";
		const prefix = this.#theme.fg("accent", `Comment line ${editor.line + 1}: `);
		const inputLine = editor.input.render(Math.max(1, width - visibleWidth(prefix)))[0] ?? "";
		return truncateToWidth(prefix + inputLine, width);
	}

	#footerHints(): string {
		return "↑↓ scroll · c comment · d delete · 1 approve · 2 approve+compact · 3 reject · Esc cancel";
	}

	#scrollIndicator(totalRows: number, viewportHeight: number): string[] {
		const indicator = clipIndicator(this.#scrollOffset, viewportHeight, totalRows);
		return indicator ? [this.#theme.fg("dim", indicator)] : [];
	}

	#viewportHeight(totalRows: number, editorRows: number): number {
		const terminalRows = this.#tui.terminal.rows || 40;

		if (this.#fullscreen) return Math.max(3, terminalRows - 2 - editorRows);
		const cap = Math.max(3, Math.floor(terminalRows * 0.7) - 2 - editorRows);
		return Math.max(3, Math.min(totalRows, cap));
	}

	#pageSize(): number {
		return Math.max(1, this.#viewportHeight(Number.MAX_SAFE_INTEGER, this.#editor ? 2 : 0));
	}

	#scrollOffsetFor(rows: Row[], viewportHeight: number): number {
		const start = rows.findIndex((row) => row.line === this.#cursor);
		if (start < 0) return clamp(this.#scrollOffset, 0, Math.max(0, rows.length - viewportHeight));
		let end = start;
		for (let i = rows.length - 1; i >= 0; i--) {
			if (rows[i]?.line === this.#cursor) {
				end = i;
				break;
			}
		}
		let offset = this.#scrollOffset;
		if (start < offset) offset = start;
		if (end + 1 > offset + viewportHeight) offset = end + 1 - viewportHeight;
		return clamp(offset, 0, Math.max(0, rows.length - viewportHeight));
	}

	#move(delta: number): void {
		const total = this.#sourceLines.length;
		this.#cursor = clamp(this.#cursor + delta, 0, Math.max(0, total - 1));
		this.#requestRender();
	}

	#openEditor(): void {
		const line = this.#cursor;
		const input = new Input();
		const existing = this.#comments.get(line);
		if (existing !== undefined) input.setValue(existing);
		input.onSubmit = (value: string) => {
			const trimmed = value.trim();
			if (trimmed) this.#comments.set(line, trimmed);
			else this.#comments.delete(line);
			this.#editor = undefined;
			this.invalidate();
			this.#requestRender();
		};
		input.onEscape = () => {
			this.#editor = undefined;
			this.#requestRender();
		};
		input.focused = this.#focused;
		this.#editor = { input, line };
		this.#requestRender();
	}

	#finish(verdict: PlanVerdict): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#done({ verdict, comments: this.#sortedComments() });
	}

	#sortedComments(): PlanLineComment[] {
		return [...this.#comments.entries()]
			.sort(([a], [b]) => a - b)
			.map(([line, text]) => ({ line: line + 1, text }));
	}
}
