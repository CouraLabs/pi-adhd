export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export function replaceTabs(text: string): string {
	return text.replaceAll("\t", "    ");
}

export function clipIndicator(offset: number, rows: number, totalRows: number): string {
	const above = offset > 0;
	const below = offset + rows < totalRows;
	if (above && below) return "↕";
	if (above) return "↑";
	if (below) return "↓";
	return "";
}
