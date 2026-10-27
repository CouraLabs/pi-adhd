export { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export { clamp, replaceTabs, clipIndicator } from "../../../shared/util.ts";

export const ELLIPSIS = "…";

export function padding(n: number): string {
	return n > 0 ? " ".repeat(n) : "";
}

export const SYMBOLS = {
	nav: { cursor: "❯", selected: "➤" },
	radio: { selected: "◉", unselected: "○" },
	checkbox: { checked: "[x]", unchecked: "[ ]" },
	boxRound: {
		topLeft: "╭",
		topRight: "╮",
		bottomLeft: "╰",
		bottomRight: "╯",
		horizontal: "─",
		vertical: "│",
		teeRight: "├",
		teeLeft: "┤",
	},
	status: { success: "+", warning: "~" },
	format: { bullet: "•" },
} as const;

export function renderInlineMarkdown(text: string, baseColor?: (t: string) => string): string {
	if (typeof text !== "string") return (baseColor ?? (t => t))(text != null ? String(text) : "");
	return (baseColor ?? (t => t))(text);
}

export function windowLines(lines: readonly string[], offset: number, rows: number): string[] {
	const out: string[] = [];
	for (let i = 0; i < rows; i++) {
		out.push(lines[offset + i] ?? "");
	}
	return out;
}

function formatKeyHints(keys: readonly string[]): string {
	return keys.join("/");
}

export function keyLabel(keys: readonly string[], fallback: string): string {
	const [first = ""] = formatKeyHints(keys).split("/");
	if (!first) return fallback;
	return first === "escape" ? "Esc" : first === "pageup" ? "PgUp" : first === "pagedown" ? "PgDn" : first;
}
