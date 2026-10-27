/**
 * submodes — shared agent-submode state for pi-adhd.
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
 *     one. It is the only submode that may change code, so it keeps the code
 *     tools instead of the read-only whitelist; web and job tools stay out of
 *     every submode.
 *
 * The state lives on `globalThis`, keyed by a registered symbol, so every
 * pi-adhd extension instance reads and mutates the same value. Extensions
 * subscribe to re-render when the submode changes.
 *
 * The value is session-scoped, not global configuration: the `submodes`
 * extension snapshots it into a `submode-state` session entry on every switch
 * and restores the branch-local snapshot on `session_start`. Two pi instances
 * (or two sessions in one process) therefore never share a submode — the store
 * only mirrors the active session for the in-process extensions that read it.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { SUBMODE_GRILL, SUBMODE_PLAN, SUBMODE_STRAIGHT } from "./glyphs.ts";
import { createGlobalStore } from "./store.ts";
import { readUserPrompt } from "./user-prompts.ts";

/** The available submodes. `"none"` means no submode is active. */
export type Submode = "none" | "plan" | "grill" | "straight";

/** The submode a fresh install starts in. */
export const DEFAULT_SUBMODE: Submode = "none";

/** Whether `value` is a submode name; guards persisted values and user input. */
export function isSubmode(value: unknown): value is Submode {
	return value === "none" || value === "plan" || value === "grill" || value === "straight";
}

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
 * tools plus the spawn tools and the exit tool. Plan and Grill share this
 * set; Plan adds `plan-write`.
 */
const READ_ONLY_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"ask",
	"submode-exit",
	"spawn",
] as const;

/**
 * Tools the model may use inside each submode, by registered name. Plan and
 * Grill are read-only plus the spawn tools: they can delegate exploration
 * and plan review, but cannot edit or write files. Straight is the only
 * submode that may change code — it implements the approved feature itself —
 * so it keeps the code tools rather than the read-only whitelist Plan and
 * Grill share. Web and job tools are absent from every submode; anything not
 * listed is dropped, so a new tool must be added here deliberately.
 *
 * Only names pi actually registers survive `setActiveTools`; anything else is
 * dropped silently, so keep every entry to a real tool name. Plan may submit a
 * plan (`plan-write`); Grill must not, so it is absent from Grill's set.
 */
export const SUBMODE_TOOLS: Record<ActiveSubmode, readonly string[]> = {
	plan: [...READ_ONLY_TOOLS, "plan-write"],
	grill: [...READ_ONLY_TOOLS],
	// Straight implements the feature, so it keeps the code tools rather than
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
		"spawn",
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

/** Prompt section tag for each active submode. */
export const SUBMODE_SECTION: Record<ActiveSubmode, string> = {
	plan: PLAN_SECTION,
	grill: GRILL_SECTION,
	straight: STRAIGHT_SECTION,
};

/** Prompt asset file name for each active submode, in the packaged and user prompt folders. */
export const SUBMODE_PROMPT_FILE: Record<ActiveSubmode, string> = {
	plan: "plan.md",
	grill: "grill.md",
	straight: "straight.md",
};

const SUBMODE_PROMPTS_DIR = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"extensions",
	"agent",
	"submodes",
	"prompts",
);

const packagedPromptCache = new Map<ActiveSubmode, string>();

/** The prompt shipped with the package for a submode; the fallback for user edits. */
export function packagedSubmodePrompt(submode: ActiveSubmode): string {
	const cached = packagedPromptCache.get(submode);
	if (cached !== undefined) return cached;
	const text = readFileSync(path.join(SUBMODE_PROMPTS_DIR, SUBMODE_PROMPT_FILE[submode]), "utf8");
	packagedPromptCache.set(submode, text);
	return text;
}

/** The submode's prompt as the user has edited it, else the packaged text. Read fresh on every call. */
export function readSubmodePrompt(submode: ActiveSubmode): string {
	return readUserPrompt("submodes", SUBMODE_PROMPT_FILE[submode], packagedSubmodePrompt(submode));
}

/** Per-submode role sentence for the ACTIVE SUBMODE directive. */
export const SUBMODE_ROLE: Record<ActiveSubmode, string> = {
	plan: "You are the architect: study the codebase, then submit a plan for review. Do not edit or write files.",
	grill: "You are the designer: interview the user to a shared understanding. Do not implement, write a plan, or edit files.",
	straight:
		"You are the implementer: ask clarifying questions, explore the codebase, propose designs, then implement the approved one.",
};

/** Per-submode handoff sentence: how the model leaves or moves on. */
export const SUBMODE_HANDOFF: Record<ActiveSubmode, string> = {
	plan: "Submit the finished plan with `plan-write`; leave or switch with `submode-exit`.",
	grill: "Ask questions with `ask`; leave or switch with `submode-exit`.",
	straight: "Work the phases to a finished feature; leave with `submode-exit` when the user has the result.",
};

/**
 * A concise directive naming the active submode, its role, and the handoff tool.
 * Prepended to the submode section so the model knows which submode it is in
 * regardless of the main mode.
 */
export function submodeDirective(submode: ActiveSubmode): string {
	return [`ACTIVE SUBMODE: ${SUBMODE_NAME[submode]}.`, SUBMODE_ROLE[submode], SUBMODE_HANDOFF[submode]].join(" ");
}

/**
 * The tool policy section, emitted last in the system prompt. It states the
 * allowed set and every forbidden name outright, since the main mode may name
 * tools the submode forbids.
 */
export function formatToolPolicy(
	submode: ActiveSubmode,
	allowed: readonly string[],
	forbidden: readonly string[],
): string {
	return [
		`# Tool policy — ${SUBMODE_NAME[submode]} submode`,
		"",
		"This section overrides every tool name mentioned anywhere earlier in this prompt.",
		"",
		`You may call only these tools: ${allowed.map((name) => `\`${name}\``).join(", ")}.`,
		"",
		`These tools do not exist in this submode and a call to one fails: ${forbidden.map((name) => `\`${name}\``).join(", ")}.`,
		"",
		"Do not call them, do not name them, and do not plan steps that require them.",
	].join("\n");
}

/** Maps pi tool names to the names a non-pi host (the Claude Agent SDK) calls them. */
export type ToolNameMap = ReadonlyMap<string, string>;

function renameToolsInText(text: string, toolNames: ToolNameMap): string {
	return text.replace(/([`"])([a-z][a-z-]*)\1/g, (match, quote: string, name: string) => {
		const renamed = toolNames.get(name);
		return renamed === undefined ? match : `${quote}${renamed}${quote}`;
	});
}

/**
 * The prompt sections for the active submode, keyed by section tag, for a host
 * that builds its own system prompt instead of reading pi's. Every pi tool name
 * in the submode text, the directive, and the tool policy is renamed through
 * `toolNames`; its keys are the complete set of tools the host offers, so any
 * key a submode does not allow is listed as forbidden. Empty when no submode
 * is active.
 */
export function getSubmodePromptSections(toolNames: ToolNameMap): Record<string, string> {
	const submode = getSubmode();
	if (submode === "none") return {};
	const allowedNames = new Set(SUBMODE_TOOLS[submode].filter((name) => toolNames.has(name)).map((name) => toolNames.get(name) as string));
	const forbiddenNames = new Set([...toolNames.values()].filter((name) => !allowedNames.has(name)));
	const body = `${submodeDirective(submode)}\n\n${readSubmodePrompt(submode)}`;
	return {
		[SUBMODE_SECTION[submode]]: renameToolsInText(body, toolNames),
		[POLICY_SECTION]: formatToolPolicy(submode, [...allowedNames].sort(), [...forbiddenNames].sort()),
	};
}

const store = createGlobalStore<Submode>(Symbol.for("@couralabs/pi-adhd/agent-submode"), DEFAULT_SUBMODE);

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

/** Session entry customType for submode snapshots (see pi.appendEntry). */
export const SUBMODE_STATE_ENTRY_TYPE = "submode-state";

/**
 * Reconstruct the submode from session entries: the latest valid
 * `submode-state` snapshot reachable on the current branch wins; malformed
 * entries are skipped so a corrupt entry can never break startup. Returns
 * undefined when the branch carries no snapshot, so the caller applies its own
 * default.
 */
export function restoreSubmodeFromEntries(entries: readonly unknown[]): Submode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== SUBMODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { submode?: unknown } | undefined;
		if (isSubmode(data?.submode)) return data.submode;
	}
	return undefined;
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
	plan: `${SUBMODE_LABEL.plan} submode. Read-only architect: studies the codebase and submits an implementation plan for line-by-line review. The toolset narrows to read-only plus the spawn tools.`,
	grill: `${SUBMODE_LABEL.grill} submode. Read-only designer: interviews you to a shared understanding across a design tree before any plan or code exists.`,
	straight: `${SUBMODE_LABEL.straight} submode. Guided feature development: asks clarifying questions, explores the codebase, proposes designs, then implements with the code tools — web and job tools stay unavailable in every submode.`,
};
