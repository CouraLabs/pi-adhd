/** Prompt chevron shared by the prompt editor and user messages. */
export const PROMPT = "⟫";

/** Heavy left rule that replaces the built-in tool background. */
export const RULE = "┃";

/** Ellipsis appended when a line is truncated. */
export const ELLIPSIS = "…";

/** Separator between status/usage segments. */
export const SEPARATOR = " ⫶ ";

// ── Editor field box ────────────────────────────────────────────────────────

/** Top-left corner of the editor field. */
export const BOX_TOP_LEFT = "╭";
/** Top-right corner of the editor field. */
export const BOX_TOP_RIGHT = "╮";
/** Bottom-left corner of the editor field. */
export const BOX_BOTTOM_LEFT = "╰";
/** Bottom-right corner of the editor field. */
export const BOX_BOTTOM_RIGHT = "╯";
/** Horizontal edge of the editor field. */
export const BOX_HORIZONTAL = "─";
/** Vertical edge of the editor field. */
export const BOX_VERTICAL = "│";

// ── Status icons ────────────────────────────────────────────────────────────

/** Monochrome Unicode cache glyph for the cache-hit indicator. */
export const CACHE_GLYPH = "⮎";

/** Filled cell of the context-window gauge. */
export const CONTEXT_FILLED = "█";

/** Empty cell of the context-window gauge. */
export const CONTEXT_EMPTY = "░";

/** Input (prompt) token marker. */
export const INPUT = "↑";

/** Output (completion) token marker. */
export const OUTPUT = "↓";

/** Thinking-level markers for the footer, keyed by pi's model thinking level. */
export const THINKING_LEVELS = {
	off: "",
	minimal: "▻",
	low: "►",
	medium: "▶▻",
	high: "▶▶",
	xhigh: "▶▶▷",
	max: "▶▶▶",
	pro: "⋙⋙⋙",
} as const;
