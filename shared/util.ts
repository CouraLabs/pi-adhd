/**
 * util — small pure helpers shared across pi-pack extensions.
 */

/** Clamp `value` to the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

/** Replace tabs with four spaces; tabs render inconsistently across terminals. */
export function replaceTabs(text: string): string {
	return text.replaceAll("\t", "    ");
}

/** Which scroll directions have hidden content: `↕`, `↑`, `↓`, or `""`. */
export function clipIndicator(offset: number, rows: number, totalRows: number): string {
	const above = offset > 0;
	const below = offset + rows < totalRows;
	if (above && below) return "↕";
	if (above) return "↑";
	if (below) return "↓";
	return "";
}
