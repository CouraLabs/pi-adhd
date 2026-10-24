/** Prompt chevron shared by the prompt editor and user messages. */
export const PROMPT = "❯";

/** Status glyph before each tool call, colored with the call's status. */
export const TOOL_PICK = "⯁";

/** Glyph for a settled agent run in the loading widget above the editor. */
export const TURN_DONE = "✓";

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
export const CACHE_GLYPH = "⮏";

/** Glyph for the tokens-per-second rate on the loading widget — the former cache glyph, freed when the cache moved to `⮏`. */
export const RATE_GLYPH = "⭍";

// ── Context-window gauge ────────────────────────────────────────────────────

/** Shading ramp for the footer's context gauge: empty → light → heavy → full. */
export const GAUGE_GLYPHS = ["░", "▒", "▓", "█"];

/** Context-usage icon, drawn before the percentage in the gauge's color. */
export const CONTEXT_GLYPH = "⛁";

/** Input (prompt) token marker. */
export const INPUT = "↑";

/** Output (completion) token marker. */
export const OUTPUT = "↓";

// ── Mode and submode labels ─────────────────────────────────────────────────

/** Pi agent-mode glyph. */
export const MODE_PI = "π";
/** Work agent-mode glyph. */
export const MODE_WORK = "⦵";
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
	minimal: "∙",
	low: "○",
	medium: "◔",
	high: "◑",
	xhigh: "◕",
	max: "●",
	pro: "⛬",
} as const;
