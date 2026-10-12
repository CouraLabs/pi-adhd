/**
 * submodes — shared agent-submode state for pi-pack.
 *
 * A submode is a temporary, additive mode layered on top of the main agent
 * mode (see `shared/modes.ts`). Unlike the main mode, which *replaces* pi's
 * system prompt, a submode *appends* a named prompt section and narrows the
 * active tool set:
 *
 *   - `"plan"`: the architect. Studies the codebase and submits an
 *     implementation plan for line-by-line review via `plan-write`.
 *   - `"grill"`: the designer. Interviews the user to a shared understanding,
 *     mapping a design tree, before any plan or code exists.
 *   - `"straight"`: the guided implementer. Asks clarifying questions,
 *     explores the codebase, proposes designs, then implements the approved
 *     one. It is the only submode that may change code, so it keeps the full
 *     toolset.
 *
 * The state lives on `globalThis`, keyed by a registered symbol, so every
 * pi-pack extension instance reads and mutates the same value. Extensions
 * subscribe to re-render when the submode changes.
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { SUBMODE_GRILL, SUBMODE_PLAN, SUBMODE_STRAIGHT } from "./glyphs.ts";
import { createGlobalStore } from "./store.ts";

/** The available submodes. `"none"` means no submode is active. */
export type Submode = "none" | "plan" | "grill" | "straight";

/** The submode a fresh install starts in. */
export const DEFAULT_SUBMODE: Submode = "none";

/** Plain submode name, for prompt text and mid-sentence prose. */
export const SUBMODE_NAME: Record<Submode, string> = {
	none: "none",
	plan: "Plan",
	grill: "Grill",
	straight: "Straight",
};

/**
 * Submode name as displayed, glyph included. `none` renders nothing.
 */
export const SUBMODE_LABEL: Record<Submode, string> = {
	none: "",
	plan: `${SUBMODE_PLAN} Plan`,
	grill: `${SUBMODE_GRILL} Grill`,
	straight: `${SUBMODE_STRAIGHT} Straight`,
};

/** A submode that is actually active. */
export type ActiveSubmode = Exclude<Submode, "none">;

/**
 * Tools every read-only submode may use, by registered name: the read/search
 * tools plus the subagent tools and the exit tool. Plan and Grill share this
 * set; Plan adds `plan-write`.
 */
const READ_ONLY_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"ask",
	"submode-exit",
	"subagent",
	"get_subagent_result",
	"steer_subagent",
] as const;

/**
 * Tools the model may use inside each submode, by registered name. Plan and
 * Grill are read-only plus the subagent tools: they can delegate exploration
 * and plan review, but cannot edit or write files. Straight is the only
 * submode that may change code — it implements the approved feature itself —
 * so it keeps the full toolset.
 *
 * Only names pi actually registers survive `setActiveTools`; anything else is
 * dropped silently, so keep every entry to a real tool name. Plan may submit a
 * plan (`plan-write`); Grill must not, so it is absent from Grill's set.
 */
export const SUBMODE_TOOLS: Record<ActiveSubmode, readonly string[]> = {
	plan: [...READ_ONLY_TOOLS, "plan-write"],
	grill: [...READ_ONLY_TOOLS],
	// Straight implements the feature, so it keeps the full toolset rather than
	// the read-only whitelist Plan and Grill share. Every other submode forbids
	// `edit` and `write`; Straight is the one that must not.
	straight: [
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
		"ask",
		"todo",
		"subagent",
		"get_subagent_result",
		"steer_subagent",
		"submode-exit",
	],
};

/** Prompt section tag used for the Plan submode. */
export const PLAN_SECTION = "plan_mode";
/** Prompt section tag used for the Grill submode. */
export const GRILL_SECTION = "grill_mode";
/** Prompt section tag used for the Straight submode. */
export const STRAIGHT_SECTION = "straight_mode";
/**
 * Prompt section tag for the generated tool policy. It is appended after the
 * submode section so it is the last text in the system prompt.
 */
export const POLICY_SECTION = "submode_policy";

const store = createGlobalStore<Submode>(Symbol.for("couralabs.pi-pack:agent-submode"), DEFAULT_SUBMODE);

/** The current submode. */
export function getSubmode(): Submode {
	return store.get();
}

/** Set the current submode and notify subscribers. No-op when unchanged. */
export function setSubmode(submode: Submode): void {
	store.set(submode);
}

/** Subscribe to submode changes; returns an unsubscribe function. */
export function subscribeSubmode(listener: (submode: Submode) => void): () => void {
	return store.subscribe(listener);
}

/** Footer label color: Plan uses the success token, Grill uses warning, and
 *  Straight uses accent. */
export function submodeColor(submode: Submode): ThemeColor {
	return SUBMODE_COLOR[submode];
}

const SUBMODE_COLOR: Record<Submode, ThemeColor> = {
	none: "success",
	plan: "success",
	grill: "warning",
	straight: "accent",
};

/** One-sentence explanation of what a submode does, shown when it becomes active. */
export const SUBMODE_NOTICE: Record<Submode, string> = {
	none: "Submode off. The full toolset is restored and the normal coder agent is in charge.",
	plan: `${SUBMODE_LABEL.plan} submode. Read-only architect: studies the codebase and submits an implementation plan for line-by-line review. The toolset narrows to read-only plus the subagent tools.`,
	grill: `${SUBMODE_LABEL.grill} submode. Read-only designer: interviews you to a shared understanding across a design tree before any plan or code exists.`,
	straight: `${SUBMODE_LABEL.straight} submode. Guided feature development: asks clarifying questions, explores the codebase, proposes designs, then implements with the full toolset.`,
};
