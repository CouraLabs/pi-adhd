import {
	copyToClipboard,
	CustomEditor,
	type KeybindingsManager,
	type Theme,
	type ThemeStyle,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	CURSOR_MARKER,
	Editor,
	getKeybindings,
	getNativeClipboard,
	matchesKey,
	mixColors,
	renderFakeCursor,
	rgbColor,
	truncateToWidth,
	visibleWidth,
	type Color,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { wordWrapLine, type TextChunk } from "@earendil-works/pi-tui/dist/components/editor.js";
import { decodePrintableKey } from "@earendil-works/pi-tui/dist/keys.js";
import { formatCwd } from "../../../shared/format.ts";
import { agentModeBorderColor, getAgentMode } from "../../../shared/modes.ts";
import {
	BOX_BOTTOM_LEFT,
	BOX_BOTTOM_RIGHT,
	BOX_HORIZONTAL,
	BOX_TOP_LEFT,
	BOX_TOP_RIGHT,
	BOX_VERTICAL,
	ELLIPSIS,
	PROMPT,
	SEPARATOR,
} from "../../../shared/glyphs.ts";
import type { GitInfo } from "./git.ts";
import { imageMarkerSpans, pasteImageFromClipboard } from "./image-paste.ts";
import { highlightMarkdownLines, type HighlightSpan, type LineHighlight } from "./markdown-highlight.ts";
import {
	deleteTextRange,
	normalizeSelection,
	selectionCoversText,
	selectedColumns,
	selectionText,
	type ActiveSelection,
	type EditorPos,
	type SelectionSpan,
} from "./selection.ts";

function scrollCount(border: string | undefined): number {
	if (!border) return 0;
	const plain = border.replace(/\x1b\[[0-9;]*m/g, "");
	const up = /↑\s*(\d+)/.exec(plain);
	if (up) return Number(up[1]);
	const down = /↓\s*(\d+)/.exec(plain);
	return down ? Number(down[1]) : 0;
}

const BOX_MARGIN = 0;
const SELECTION_COPY_DEBOUNCE_MS = 350;

interface LayoutEntry {

	text: string;

	hasCursor: boolean;

	cursorPos?: number;
}

interface StyledChunk {

	text: string;

	cursorPos?: number;
}

interface EditorState {

	lines: string[];

	cursorLine: number;

	cursorCol: number;
}

interface EditorInternals {

	state: EditorState;

	lastAction: string | null;

	moveCursor(deltaLine: number, deltaCol: number): void;

	moveToLineStart(): void;

	moveToLineEnd(): void;

	moveWordBackwards(): void;

	moveWordForwards(): void;

	setCursorCol(col: number): void;

	pushUndoSnapshot(): void;

	cancelAutocomplete(): void;

	exitHistoryBrowsing(): void;
}

type SegmentFunction = (text: string, mode: string) => Iterable<Intl.SegmentData>;

export interface EditorLocationInfo {

	cwd: string;

	git: GitInfo;

	theme: Theme;

	fullCwd: boolean;
}

export type LocationProvider = () => EditorLocationInfo | undefined;

export type PromptStatus = "idle" | "running";
export type StatusProvider = () => PromptStatus | undefined;

const PLACEHOLDER_IDLE = "What are we going to build today?";

const PLACEHOLDER_RUNNING = "Press {keys} to Queue or Enter to steer new request...";

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function queueKeyText(): string {
	const keys = getKeybindings().getKeys("app.message.followUp");
	if (keys.length === 0) return "the queue key";
	return keys
		.map((key) =>
			key
				.split("+")
				.map((part) => {
					const display = process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part;
					return display.charAt(0).toUpperCase() + display.slice(1);
				})
				.join("+"),
		)
		.join(" / ");
}

function mergeAtomicSegments(
	segments: Intl.SegmentData[],
	text: string,
	spans: Array<{ start: number; end: number }>,
): Intl.SegmentData[] {
	const result: Intl.SegmentData[] = [];
	let spanIndex = 0;
	for (const segment of segments) {
		while (spanIndex < spans.length && spans[spanIndex].end <= segment.index) {
			spanIndex++;
		}
		const span = spans[spanIndex];
		if (span && segment.index >= span.start && segment.index < span.end) {
			if (segment.index === span.start) {
				result.push({
					segment: text.slice(span.start, span.end),
					index: span.start,
					input: text,
				} as Intl.SegmentData);
			}
			continue;
		}
		result.push(segment);
	}
	return result;
}

function quotePathIfNeeded(path: string): string {
	if (!/[\s"'\\$`]/.test(path)) return path;
	return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`")}"`;
}

export class FieldEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getLocation: LocationProvider,
		private readonly getStatus?: StatusProvider,
	) {
		super(tui, theme, keybindings);

		this.borderColor = (text) => this.paint(text);
		this.onPasteImage = () => {
			void this.pasteFromClipboard();
		};
		this.installInstanceOverrides();
	}

	private selection: ActiveSelection | undefined;

	private copyTimer: ReturnType<typeof setTimeout> | undefined;

	private selectionColorsTheme: Theme | undefined;

	private selectionColors: { fg: Color; bg: Color } | undefined;

	private selectionStyleColors(theme: Theme): { fg: Color; bg: Color } {
		if (this.selectionColorsTheme !== theme || !this.selectionColors) {
			const accent = theme.colors.accent;
			this.selectionColors = {
				bg: mixColors(accent, rgbColor(255, 255, 255), 0.5),
				fg: mixColors(accent, rgbColor(0, 0, 0), 0.65),
			};
			this.selectionColorsTheme = theme;
		}
		return this.selectionColors;
	}

	private installInstanceOverrides(): void {
		const owner = this as unknown as Record<string, unknown>;
		const baseSegment = (Editor.prototype as unknown as { segment: SegmentFunction }).segment;
		owner.segment = (text: string, mode: string) => {
			const segments = baseSegment.call(this, text, mode);
			const spans = imageMarkerSpans(text);
			if (spans.length === 0) return segments;
			return mergeAtomicSegments([...segments], text, spans);
		};
		owner.layoutText = (contentWidth: number) => this.layoutStyled(contentWidth);
	}

	private internals(): EditorInternals {
		return this as unknown as EditorInternals;
	}

	private placeholder(): string | undefined {
		const status = this.getStatus?.();
		if (!status) return undefined;
		return status === "running" ? PLACEHOLDER_RUNNING.replace("{keys}", queueKeyText()) : PLACEHOLDER_IDLE;
	}

	private paint(text: string): string {
		return this.getLocation()?.theme.fg(agentModeBorderColor(getAgentMode()), text) ?? text;
	}

	render(width: number): string[] {
		if (width <= 0) return [];

		const margin = width >= 8 + BOX_MARGIN * 2 ? BOX_MARGIN : 0;
		const boxWidth = width - margin * 2;
		if (boxWidth < 8) return super.render(width);

		const contentWidth = Math.max(1, boxWidth - 6);
		const lines = super.render(contentWidth);
		if (lines.length < 2) return lines;

		const internals = this as unknown as { renderedVisibleLineCount?: number };
		const maxVisible = Math.max(0, lines.length - 2);
		const visibleCount = Math.min(internals.renderedVisibleLineCount ?? maxVisible, maxVisible);
		const content = lines.slice(1, 1 + visibleCount);
		const trailing = lines.slice(1 + visibleCount + 1);

		const info = this.getLocation();
		const pad = " ".repeat(margin);

		const hiddenAbove = scrollCount(lines[0]);
		const hiddenBelow = scrollCount(lines[1 + visibleCount]);
		const theme = info?.theme;
		const dim = (text: string): string => theme ? theme.fg("dim", text) : text;

		const placeholder = this.placeholder();
		if (placeholder && this.getText() === "" && content.length > 0) {
			content[0] = this.placeholderRow(truncateToWidth(placeholder, contentWidth), dim);
		}
		const topLabel = hiddenAbove > 0 ? dim(`↑${hiddenAbove}`) : "";
		const bottomLabel = [
			this.locationSegment(),
			hiddenBelow > 0 ? dim(`↓${hiddenBelow}`) : "",
		]
			.filter(Boolean)
			.join(theme ? theme.fg("dim", SEPARATOR) : SEPARATOR);
		const out: string[] = [pad + this.borderLine(boxWidth, BOX_TOP_LEFT, BOX_TOP_RIGHT, topLabel, "left") + pad];
		content.forEach((line, index) => {
			const prefix = index === 0 ? `${info ? info.theme.fg("text", PROMPT) : PROMPT} ` : "  ";
			const padded = line + " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
			out.push(pad + this.paint(`${BOX_VERTICAL} ${prefix}`) + padded + this.paint(` ${BOX_VERTICAL}`) + pad);
		});
		out.push(pad + this.borderLine(boxWidth, BOX_BOTTOM_LEFT, BOX_BOTTOM_RIGHT, bottomLabel) + pad);

		for (const line of trailing) {
			out.push(pad + line + " ".repeat(Math.max(0, boxWidth - visibleWidth(line))) + pad);
		}
		return out;
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const result = super.handleMouse(event);
		if (result) {
			this.clearSelection();
		}
		return result;
	}

	override setText(text: string): void {
		super.setText(text);
		this.clearSelection();
	}

	override handleInput(data: string): void {
		if (this.handleSelectionInput(data)) return;
		super.handleInput(data);
	}

	private handleSelectionInput(data: string): boolean {
		if (matchesKey(data, "ctrl+a")) {
			this.selectAll();
			return true;
		}
		if (matchesKey(data, "shift+left")) {
			this.extendSelection(() => this.internals().moveCursor(0, -1));
			return true;
		}
		if (matchesKey(data, "shift+right")) {
			this.extendSelection(() => this.internals().moveCursor(0, 1));
			return true;
		}
		if (matchesKey(data, "shift+up")) {
			this.extendSelection(() => this.internals().moveCursor(-1, 0));
			return true;
		}
		if (matchesKey(data, "shift+down")) {
			this.extendSelection(() => this.internals().moveCursor(1, 0));
			return true;
		}
		if (matchesKey(data, "shift+home")) {
			this.extendSelection(() => this.internals().moveToLineStart());
			return true;
		}
		if (matchesKey(data, "shift+end")) {
			this.extendSelection(() => this.internals().moveToLineEnd());
			return true;
		}
		if (matchesKey(data, "ctrl+shift+left")) {
			this.extendSelection(() => this.internals().moveWordBackwards());
			return true;
		}
		if (matchesKey(data, "ctrl+shift+right")) {
			this.extendSelection(() => this.internals().moveWordForwards());
			return true;
		}
		if (!this.selection) return false;
		const kb = getKeybindings();
		if (kb.matches(data, "tui.input.copy")) {
			void this.copySelection();
			return true;
		}
		if (kb.matches(data, "app.message.copy")) {
			void this.cutSelection();
			return true;
		}
		if (kb.matches(data, "app.interrupt") && !this.isShowingAutocomplete()) {
			this.clearSelection();
			return true;
		}
		if (kb.matches(data, "app.clipboard.pasteImage")) {
			this.deleteSelection();
			return false;
		}
		if (this.isDeleteKey(data, kb)) {
			this.deleteSelection();
			return true;
		}
		if (this.isReplacementInput(data)) {
			this.deleteSelection();
			return false;
		}
		if (this.isMovementKey(data, kb)) {
			this.clearSelection();
		}
		return false;
	}

	private isDeleteKey(data: string, kb: ReturnType<typeof getKeybindings>): boolean {
		return (
			kb.matches(data, "tui.editor.deleteCharBackward")
			|| matchesKey(data, "shift+backspace")
			|| kb.matches(data, "tui.editor.deleteCharForward")
			|| matchesKey(data, "shift+delete")
			|| kb.matches(data, "tui.editor.deleteToLineStart")
			|| kb.matches(data, "tui.editor.deleteToLineEnd")
			|| kb.matches(data, "tui.editor.deleteWordBackward")
			|| kb.matches(data, "tui.editor.deleteWordForward")
		);
	}

	private isReplacementInput(data: string): boolean {
		const kb = getKeybindings();
		if (data.includes("\x1b[200~")) return true;
		if (kb.matches(data, "tui.editor.yank")) return true;
		if (kb.matches(data, "tui.input.newLine")) return true;
		if (kb.matches(data, "tui.input.tab")) return true;
		const printable = decodePrintableKey(data);
		if (printable !== undefined) return true;
		return data.length > 0 && data.charCodeAt(0) >= 32;
	}

	private isMovementKey(data: string, kb: ReturnType<typeof getKeybindings>): boolean {
		return (
			kb.matches(data, "tui.editor.cursorUp")
			|| kb.matches(data, "tui.editor.cursorDown")
			|| kb.matches(data, "tui.editor.cursorLeft")
			|| kb.matches(data, "tui.editor.cursorRight")
			|| kb.matches(data, "tui.editor.cursorLineStart")
			|| kb.matches(data, "tui.editor.cursorLineEnd")
			|| kb.matches(data, "tui.editor.cursorWordLeft")
			|| kb.matches(data, "tui.editor.cursorWordRight")
			|| kb.matches(data, "tui.editor.pageUp")
			|| kb.matches(data, "tui.editor.pageDown")
			|| kb.matches(data, "tui.editor.jumpForward")
			|| kb.matches(data, "tui.editor.jumpBackward")
			|| kb.matches(data, "tui.editor.historyPrevious")
			|| kb.matches(data, "tui.editor.historyNext")
			|| kb.matches(data, "tui.editor.undo")
		);
	}

	private extendSelection(step: () => void): void {
		const cursor = this.getCursor();
		if (!this.selection) {
			this.selection = { anchor: { ...cursor }, focus: { ...cursor } };
		}
		step();
		this.selection.focus = { ...this.getCursor() };
		const range = normalizeSelection(this.selection.anchor, this.selection.focus);
		if (!selectionCoversText(range)) {
			this.selection = undefined;
			this.cancelCopyTimer();
			return;
		}
		this.scheduleSelectionCopy();
	}

	private selectAll(): void {
		const lines = this.getLines();
		const end: EditorPos = { line: lines.length - 1, col: (lines[lines.length - 1] ?? "").length };
		const range = normalizeSelection({ line: 0, col: 0 }, end);
		if (!selectionCoversText(range)) {
			this.selection = undefined;
			return;
		}
		this.selection = { anchor: { line: 0, col: 0 }, focus: end };
		this.scheduleSelectionCopy();
	}

	private clearSelection(): void {
		this.selection = undefined;
		this.cancelCopyTimer();
	}

	private selectionRange(): SelectionSpan | undefined {
		if (!this.selection) return undefined;
		const range = normalizeSelection(this.selection.anchor, this.selection.focus);
		return selectionCoversText(range) ? range : undefined;
	}

	private selectedText(): string {
		const range = this.selectionRange();
		if (!range) return "";
		return selectionText(this.getLines(), range);
	}

	private async copySelection(): Promise<void> {
		const text = this.selectedText();
		if (!text) return;
		try {
			await copyToClipboard(text);
		} catch {
			return;
		}
	}

	private async cutSelection(): Promise<void> {
		const text = this.selectedText();
		if (!text) {
			this.deleteSelection();
			return;
		}
		try {
			await copyToClipboard(text);
		} catch {
			return;
		}
		this.deleteSelection();
	}

	private scheduleSelectionCopy(): void {
		if (this.copyTimer) clearTimeout(this.copyTimer);
		this.copyTimer = setTimeout(() => {
			this.copyTimer = undefined;
			void this.copySelection();
		}, SELECTION_COPY_DEBOUNCE_MS);
	}

	private cancelCopyTimer(): void {
		if (!this.copyTimer) return;
		clearTimeout(this.copyTimer);
		this.copyTimer = undefined;
	}

	private deleteSelection(): boolean {
		const range = this.selectionRange();
		this.clearSelection();
		if (!range) return false;
		const internals = this.internals();
		internals.pushUndoSnapshot();
		internals.lastAction = null;
		internals.exitHistoryBrowsing();
		const result = deleteTextRange(this.getLines(), range);
		internals.state.lines = result.lines;
		internals.state.cursorLine = result.cursor.line;
		internals.setCursorCol(result.cursor.col);
		internals.cancelAutocomplete();
		this.onChange?.(this.getText());
		return true;
	}

	private async pasteFromClipboard(): Promise<void> {
		try {
			const clipboard = getNativeClipboard();
			const paths = await clipboard?.getFilePaths?.();
			if (paths && paths.length > 0) {
				const bashMode = this.getText().trimStart().startsWith("!");
				const joined = bashMode ? paths.map(quotePathIfNeeded).join(" ") : paths.join("\n");
				this.insertObjectText(joined);
				this.tui.requestRender();
				return;
			}
			const marker = await pasteImageFromClipboard(this.getText() === "");
			if (marker) {
				this.insertObjectText(marker);
				this.tui.requestRender();
				return;
			}
			const text = await clipboard?.getText();
			if (text) {
				this.insertTextAtCursor(text);
				this.tui.requestRender();
			}
		} catch {
			return;
		}
	}

	private insertObjectText(text: string): void {
		const cursor = this.getCursor();
		const line = this.getLines()[cursor.line] ?? "";
		const before = cursor.col > 0 ? line[cursor.col - 1] : "";
		const after = line[cursor.col] ?? "";
		const leading = before && !/\s/.test(before) ? " " : "";
		const trailing = after && !/\s/.test(after) ? " " : "";
		this.insertTextAtCursor(`${leading}${text}${trailing}`);
	}

	private wrapChunks(line: string, maxWidth: number): TextChunk[] {
		if (!line || maxWidth <= 0) return [{ text: "", startIndex: 0, endIndex: 0 }];
		if (visibleWidth(line) <= maxWidth) return [{ text: line, startIndex: 0, endIndex: line.length }];
		const segments = (this as unknown as { segment(text: string, mode: string): Iterable<Intl.SegmentData> }).segment(
			line,
			"grapheme",
		);
		return wordWrapLine(line, maxWidth, [...segments]);
	}

	private layoutStyled(contentWidth: number): LayoutEntry[] {
		const internals = this.internals();
		const lines = internals.state.lines;
		if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
			return [{ text: "", hasCursor: true, cursorPos: 0 }];
		}
		const theme = this.getLocation()?.theme;
		const cursorLine = internals.state.cursorLine;
		const cursorCol = internals.state.cursorCol;
		const highlights = highlightMarkdownLines(lines);
		const selection = this.selectionRange();
		const entries: LayoutEntry[] = [];
		for (let line = 0; line < lines.length; line++) {
			const text = lines[line] ?? "";
			const chunks = this.wrapChunks(text, contentWidth);
			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const chunk = chunks[chunkIndex];
				const isLastChunk = chunkIndex === chunks.length - 1;
				let hasCursor = false;
				let cursorPos = 0;
				if (line === cursorLine) {
					if (isLastChunk) {
						hasCursor = cursorCol >= chunk.startIndex;
						cursorPos = cursorCol - chunk.startIndex;
					} else {
						hasCursor = cursorCol >= chunk.startIndex && cursorCol < chunk.endIndex;
						if (hasCursor) {
							cursorPos = cursorCol - chunk.startIndex;
							if (cursorPos > chunk.text.length) cursorPos = chunk.text.length;
						}
					}
				}
				const styled = theme
					? this.styleChunk(
							chunk,
							line,
							text,
							highlights[line],
							hasCursor ? cursorPos : undefined,
							selection,
							theme,
						)
					: ({ text: chunk.text, cursorPos } satisfies StyledChunk);
				entries.push({ text: styled.text, hasCursor, cursorPos: hasCursor ? styled.cursorPos : undefined });
			}
		}
		return entries;
	}

	private styleChunk(
		chunk: TextChunk,
		logicalLine: number,
		lineText: string,
		highlight: LineHighlight,
		cursorPos: number | undefined,
		selection: SelectionSpan | undefined,
		theme: Theme,
	): StyledChunk {
		const text = chunk.text;
		const selected = selection ? selectedColumns(selection, logicalLine, lineText.length) : undefined;
		const boundaries = new Set<number>([0, text.length]);
		this.addSpanBoundaries(boundaries, highlight, chunk);
		if (selected) {
			this.addClampedBoundary(boundaries, selected.from - chunk.startIndex, text.length);
			this.addClampedBoundary(boundaries, selected.to - chunk.startIndex, text.length);
		}
		if (cursorPos !== undefined) {
			boundaries.add(cursorPos);
			boundaries.add(cursorPos + this.graphemeLengthAt(text, cursorPos));
		}
		const edges = [...boundaries].filter((edge) => edge >= 0 && edge <= text.length).sort((a, b) => a - b);
		let styled = "";
		let styledCursorPos: number | undefined;
		for (let i = 0; i < edges.length - 1; i++) {
			const from = edges[i];
			const to = edges[i + 1];
			if (from === to) continue;
			if (cursorPos !== undefined && from === cursorPos) {
				if (styledCursorPos === undefined) styledCursorPos = styled.length;
				styled += text.slice(from, to);
				continue;
			}
			const style = this.spanStyleAt(highlight, chunk.startIndex + from);
			const isSelected = selected !== undefined
				&& chunk.startIndex + from >= selected.from
				&& chunk.startIndex + to <= selected.to;
			const segmentText = text.slice(from, to);
			const attributes = style ?? {};
			styled += isSelected
				? theme.style(segmentText, { ...attributes, ...this.selectionStyleColors(theme) })
				: style
					? theme.style(segmentText, style)
					: segmentText;
		}
		if (cursorPos !== undefined && styledCursorPos === undefined) {
			styledCursorPos = styled.length;
		}
		return { text: styled, cursorPos: styledCursorPos };
	}

	private addSpanBoundaries(boundaries: Set<number>, highlight: LineHighlight, chunk: TextChunk): void {
		for (const candidate of highlight.spans) {
			this.addClampedBoundary(boundaries, candidate.start - chunk.startIndex, chunk.text.length);
			this.addClampedBoundary(boundaries, candidate.end - chunk.startIndex, chunk.text.length);
		}
	}

	private addClampedBoundary(boundaries: Set<number>, value: number, max: number): void {
		const clamped = Math.max(0, Math.min(max, value));
		if (clamped >= 0 && clamped <= max) boundaries.add(clamped);
	}

	private graphemeLengthAt(text: string, pos: number): number {
		if (pos >= text.length) return 0;
		const segments = (this as unknown as { segment(text: string, mode: string): Iterable<Intl.SegmentData> }).segment(
			text.slice(pos),
			"grapheme",
		);
		const first = segments[Symbol.iterator]().next();
		return first.done ? 1 : first.value.segment.length;
	}

	private spanStyleAt(highlight: LineHighlight, index: number): ThemeStyle | undefined {
		let style: ThemeStyle | undefined;
		for (const candidate of highlight.spans) {
			if (candidate.start <= index && index < candidate.end) {
				style = candidate.style;
			}
		}
		return style;
	}

	private placeholderRow(text: string, dim: (value: string) => string): string {
		const graphemes = [...graphemeSegmenter.segment(text)];
		const atCursor = graphemes[0]?.segment ?? " ";
		const after = text.slice(atCursor.length);
		const marker = this.focused ? CURSOR_MARKER : "";
		return marker + renderFakeCursor(dim(atCursor)) + dim(after);
	}

	private borderLine(
		width: number,
		leftCorner: string,
		rightCorner: string,
		label: string,
		align: "left" | "right" = "right",
	): string {
		if (width <= 0) return "";
		if (width < 2) return this.paint(leftCorner.slice(0, width));

		const inner = width - 2;
		let text = label;
		if (visibleWidth(text) + 3 > inner) {
			const room = Math.max(0, inner - 3);
			text = room > 0 ? truncateToWidth(text, room, ELLIPSIS) : "";
		}
		const labelWidth = visibleWidth(text);
		if (labelWidth === 0) {
			return this.paint(leftCorner + BOX_HORIZONTAL.repeat(inner) + rightCorner);
		}

		const fill = inner - labelWidth - 3;
		if (align === "left") {
			return (
				this.paint(`${leftCorner}${BOX_HORIZONTAL} `) +
				text +
				this.paint(` ${BOX_HORIZONTAL.repeat(fill)}${rightCorner}`)
			);
		}
		return (
			this.paint(`${leftCorner}${BOX_HORIZONTAL.repeat(fill)} `) +
			text +
			this.paint(` ${BOX_HORIZONTAL}${rightCorner}`)
		);
	}

	private locationSegment(): string {
		const info = this.getLocation();
		if (!info) return "";
		const { cwd, git, theme, fullCwd } = info;
		const parts: string[] = [];
		if (cwd) parts.push(theme.fg("text", formatCwd(cwd, fullCwd)));

		const gitParts: string[] = [];
		if (git.branch) gitParts.push(theme.fg("accent", `⌥ ${git.branch}`));
		if (git.additions > 0) gitParts.push(theme.fg("success", `+${git.additions}`));
		if (git.removals > 0) gitParts.push(theme.fg("error", `-${git.removals}`));
		if (gitParts.length > 0) parts.push(gitParts.join(" "));

		return parts.join(theme.fg("dim", SEPARATOR));
	}
}
