/** Compact token counts shared by the footer gauge and usage segments. */
export function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

/**
 * Left margin shared by the prompt editor box and the widgets above it. The
 * editor insets its box by one column, so widgets use the same pad to line up
 * with the prompt text instead of starting flush against the terminal edge.
 */
export const WIDGET_LEFT_PADDING = " ";

/**
 * Prefix every non-empty widget line with the shared left margin.
 *
 * Idempotent in effect rather than in form: renderers hand back unpadded lines
 * and this is applied once at the point the lines leave the renderer, so a line
 * is never padded twice. Empty lines are left alone so they cost no columns.
 */
export function padWidgetLines(lines: readonly string[]): string[] {
	return lines.map((line) => (line.length > 0 ? `${WIDGET_LEFT_PADDING}${line}` : line));
}

/** Collapse the home directory to `~` for display. */
export function formatCwd(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && (cwd === home || cwd.startsWith(`${home}/`))) {
		return `~${cwd.slice(home.length)}`;
	}
	return cwd;
}
