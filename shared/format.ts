import { homedir } from "node:os";

const SGR_PATTERN = /\x1b\[[0-9;]*m/g;

const OSC_LINK_PATTERN = /\x1b\]8;;[^\x1b]*\x1b\\/g;

export function stripStyling(line: string): string {
	return line.replace(SGR_PATTERN, "").replace(OSC_LINK_PATTERN, "");
}

export function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export const WIDGET_LEFT_PADDING = " ";

export function padWidgetLines(lines: readonly string[]): string[] {
	return lines.map((line) => (line.length > 0 ? `${WIDGET_LEFT_PADDING}${line}` : line));
}

function isPathSeparator(ch: string | undefined): boolean {
	return ch === "/" || ch === "\\";
}

function lastSeparatorIndex(path: string): number {
	return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

function samePath(a: string, b: string): boolean {
	const strip = (path: string): string => path.replace(/[\\/]+$/, "");
	const [x, y] = [strip(a), strip(b)];
	return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export function formatCwd(cwd: string, full = false): string {
	const home = homedir();
	if (samePath(cwd, home)) return "~";
	if (full) {

		if (isPathSeparator(cwd[home.length]) && samePath(cwd.slice(0, home.length), home)) {
			return `~${cwd.slice(home.length)}`;
		}
		return cwd;
	}
	const trimmed = cwd.replace(/[\\/]+$/, "");

	if (trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) return cwd;
	const last = trimmed.slice(lastSeparatorIndex(trimmed) + 1);
	return "./" + (last || cwd);
}
