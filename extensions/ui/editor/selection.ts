export interface EditorPos {

	line: number;

	col: number;
}

export interface ActiveSelection {

	anchor: EditorPos;

	focus: EditorPos;
}

export interface SelectionSpan {

	start: EditorPos;

	end: EditorPos;
}

export interface SelectedColumns {

	from: number;

	to: number;
}

export function comparePositions(a: EditorPos, b: EditorPos): number {
	if (a.line !== b.line) return a.line - b.line;
	return a.col - b.col;
}

export function normalizeSelection(anchor: EditorPos, focus: EditorPos): SelectionSpan {
	return comparePositions(anchor, focus) <= 0 ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

export function selectionCoversText(range: SelectionSpan): boolean {
	return comparePositions(range.start, range.end) !== 0;
}

export function selectedColumns(
	range: SelectionSpan,
	lineIndex: number,
	lineLength: number,
): SelectedColumns | undefined {
	if (lineIndex < range.start.line || lineIndex > range.end.line) return undefined;
	const from = lineIndex === range.start.line ? range.start.col : 0;
	const to = lineIndex === range.end.line ? range.end.col : lineLength;
	if (from >= to) return undefined;
	return { from, to };
}

export function selectionText(lines: readonly string[], range: SelectionSpan): string {
	if (!selectionCoversText(range)) return "";
	const parts: string[] = [];
	for (let line = range.start.line; line <= range.end.line; line++) {
		const text = lines[line] ?? "";
		const columns = selectedColumns(range, line, text.length);
		if (!columns) {
			parts.push("");
			continue;
		}
		parts.push(text.slice(columns.from, columns.to));
	}
	return parts.join("\n");
}

export interface RangeDeletion {

	lines: string[];

	cursor: EditorPos;
}

export function deleteTextRange(lines: readonly string[], range: SelectionSpan): RangeDeletion {
	const next = [...lines];
	const { start, end } = range;
	const startText = next[start.line] ?? "";
	const endText = next[end.line] ?? "";
	const merged = startText.slice(0, start.col) + endText.slice(end.col);
	if (start.line === end.line) {
		next[start.line] = merged;
	} else {
		next.splice(start.line, end.line - start.line + 1, merged);
	}
	return { lines: next, cursor: { ...start } };
}
