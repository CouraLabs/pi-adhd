import { homedir } from "node:os";

/** SGR escape sequence: `\x1b[0-9;…m`. */
const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
/** OSC-8 hyperlink wrapper (open carrying the URL, or empty-payload terminator). */
const OSC_LINK_PATTERN = /\x1b\]8;;[^\x1b]*\x1b\\/g;

/** Strip SGR colors and OSC-8 wrappers, keeping the link's display text. */
export function stripStyling(line: string): string {
	return line.replace(SGR_PATTERN, "").replace(OSC_LINK_PATTERN, "");
}

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

/** True when `ch` is a path separator on either platform (`/` on POSIX, `\` on Windows). */
function isPathSeparator(ch: string | undefined): boolean {
	return ch === "/" || ch === "\\";
}

/** Index of the last path separator in `path`, or -1 when it has none. */
function lastSeparatorIndex(path: string): number {
	return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/**
 * Compare two paths for equality, ignoring trailing separators and, on
 * Windows, case — so `C:\\Users\\me` and `c:\\users\\me\\` are the same home.
 */
function samePath(a: string, b: string): boolean {
	const strip = (path: string): string => path.replace(/[\\/]+$/, "");
	const [x, y] = [strip(a), strip(b)];
	return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Format the working directory for the prompt-field footer.
 *
 * When `full` is true the home directory is collapsed to `~` and any other
 * path is shown in full. When false only the last path segment is shown. The
 * home directory itself is always rendered as `~`, so the toggle never turns
 * it into the bare user-name folder. Both `/` and `\` separators are accepted,
 * so Windows paths (and forward-slash paths on Windows) format correctly.
 */
export function formatCwd(cwd: string, full = false): string {
	const home = homedir();
	if (samePath(cwd, home)) return "~";
	if (full) {
		// Collapse the home prefix to `~`, keeping the native separator that follows.
		if (isPathSeparator(cwd[home.length]) && samePath(cwd.slice(0, home.length), home)) {
			return `~${cwd.slice(home.length)}`;
		}
		return cwd;
	}
	const trimmed = cwd.replace(/[\\/]+$/, "");
	// A bare root (`/`) or drive root (`C:\`) has no last folder; show it as-is.
	if (trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) return cwd;
	const last = trimmed.slice(lastSeparatorIndex(trimmed) + 1);
	return "./" + (last || cwd);
}
