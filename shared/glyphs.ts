/** Prompt chevron shared by the prompt editor and user messages. */
export const PROMPT = "❯";

/** Heavy left rule that replaces the built-in tool background. */
export const RULE = "│";

/** Ellipsis appended when a line is truncated. */
export const ELLIPSIS = "…";

/** Separator between status/usage segments. */
export const SEPARATOR = " ∙ ";

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
export const CACHE_GLYPH = "⭍";

/** Filled cell of the context-window gauge (10% of the window at ten cells). */
export const CONTEXT_FILLED = "■";

/** Half-filled cell of the context-window gauge (5% of the window at ten cells). */
export const CONTEXT_HALF = "◧";

/** Empty cell of the context-window gauge. */
export const CONTEXT_EMPTY = "□";

/** Opening bracket of the context-window gauge. */
export const CONTEXT_OPEN = "[";

/** Closing bracket of the context-window gauge. */
export const CONTEXT_CLOSE = "]";

/** Input (prompt) token marker. */
export const INPUT = "↑";

/** Output (completion) token marker. */
export const OUTPUT = "↓";

// ── Mode and submode labels ─────────────────────────────────────────────────

/** Pi agent-mode glyph. */
export const MODE_PI = "π";
/** Work agent-mode glyph. */
export const MODE_WORK = "⛑";
/** Plan submode glyph. */
export const SUBMODE_PLAN = "⚼";
/** Grill submode glyph. */
export const SUBMODE_GRILL = "𐂐";
/** Straight submode glyph. */
export const SUBMODE_STRAIGHT = "⛬";

// ── Plan-review pane ────────────────────────────────────────────────────────

/** Selected-row cursor in the plan-review pane. */
export const REVIEW_CURSOR = "❯";
/** Comment glyph shown before a plan-review comment. */
export const REVIEW_COMMENT = "💬";
/** Marker on a plan line that carries a comment. */
export const REVIEW_COMMENT_MARK = "●";

// ── Timers ──────────────────────────────────────────────────────────────────

/** Countdown glyph for an active `/timer` in the footer. */
export const TIMER_GLYPH = "⏱";
/** Pomodoro work-phase glyph. */
export const POMODORO_WORK = "🍅";
/** Pomodoro break-phase glyph. */
export const POMODORO_BREAK = "☕";

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
