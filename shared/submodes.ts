import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { SUBMODE_GRILL, SUBMODE_PLAN, SUBMODE_STRAIGHT } from "./glyphs.ts";
import { createGlobalStore } from "./store.ts";
import { readUserPrompt } from "./user-prompts.ts";

export type Submode = "none" | "plan" | "grill" | "straight";

export const DEFAULT_SUBMODE: Submode = "none";

export function isSubmode(value: unknown): value is Submode {
	return value === "none" || value === "plan" || value === "grill" || value === "straight";
}

export const SUBMODE_NAME: Record<Submode, string> = {
	none: "none",
	plan: "Plan",
	grill: "Grill",
	straight: "Straight",
};

export const SUBMODE_LABEL: Record<Submode, string> = {
	none: "",
	plan: `${SUBMODE_PLAN} Plan`,
	grill: `${SUBMODE_GRILL} Grill`,
	straight: `${SUBMODE_STRAIGHT} Straight`,
};

export type ActiveSubmode = Exclude<Submode, "none">;

const READ_ONLY_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"ask",
	"submode-exit",
	"spawn",
] as const;

export const SUBMODE_TOOLS: Record<ActiveSubmode, readonly string[]> = {
	plan: [...READ_ONLY_TOOLS, "plan-write"],
	grill: [...READ_ONLY_TOOLS],

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

export const PLAN_SECTION = "plan_mode";

export const GRILL_SECTION = "grill_mode";

export const STRAIGHT_SECTION = "straight_mode";

export const POLICY_SECTION = "submode_policy";

export const SUBMODE_SECTION: Record<ActiveSubmode, string> = {
	plan: PLAN_SECTION,
	grill: GRILL_SECTION,
	straight: STRAIGHT_SECTION,
};

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

export function packagedSubmodePrompt(submode: ActiveSubmode): string {
	const cached = packagedPromptCache.get(submode);
	if (cached !== undefined) return cached;
	const text = readFileSync(path.join(SUBMODE_PROMPTS_DIR, SUBMODE_PROMPT_FILE[submode]), "utf8");
	packagedPromptCache.set(submode, text);
	return text;
}

export function readSubmodePrompt(submode: ActiveSubmode): string {
	return readUserPrompt("submodes", SUBMODE_PROMPT_FILE[submode], packagedSubmodePrompt(submode));
}

export const SUBMODE_ROLE: Record<ActiveSubmode, string> = {
	plan: "You are the architect: study the codebase, then submit a plan for review. Do not edit or write files.",
	grill: "You are the designer: interview the user to a shared understanding. Do not implement, write a plan, or edit files.",
	straight:
		"You are the implementer: ask clarifying questions, explore the codebase, propose designs, then implement the approved one.",
};

export const SUBMODE_HANDOFF: Record<ActiveSubmode, string> = {
	plan: "Submit the finished plan with `plan-write`; leave or switch with `submode-exit`.",
	grill: "Ask questions with `ask`; leave or switch with `submode-exit`.",
	straight: "Work the phases to a finished feature; leave with `submode-exit` when the user has the result.",
};

export function submodeDirective(submode: ActiveSubmode): string {
	return [`ACTIVE SUBMODE: ${SUBMODE_NAME[submode]}.`, SUBMODE_ROLE[submode], SUBMODE_HANDOFF[submode]].join(" ");
}

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

export type ToolNameMap = ReadonlyMap<string, string>;

function renameToolsInText(text: string, toolNames: ToolNameMap): string {
	return text.replace(/([`"])([a-z][a-z-]*)\1/g, (match, quote: string, name: string) => {
		const renamed = toolNames.get(name);
		return renamed === undefined ? match : `${quote}${renamed}${quote}`;
	});
}

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

export function getSubmode(): Submode {
	return store.get();
}

export function setSubmode(submode: Submode): void {
	store.set(submode);
}

export function subscribeSubmode(listener: (submode: Submode) => void): () => void {
	return store.subscribe(listener);
}

export const SUBMODE_STATE_ENTRY_TYPE = "submode-state";

export function restoreSubmodeFromEntries(entries: readonly unknown[]): Submode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== SUBMODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { submode?: unknown } | undefined;
		if (isSubmode(data?.submode)) return data.submode;
	}
	return undefined;
}

export function submodeColor(submode: Submode): ThemeColor {
	return SUBMODE_COLOR[submode];
}

const SUBMODE_COLOR: Record<Submode, ThemeColor> = {
	none: "success",
	plan: "success",
	grill: "warning",
	straight: "accent",
};

export const SUBMODE_NOTICE: Record<Submode, string> = {
	none: "Submode off. The full toolset is restored and the normal coder agent is in charge.",
	plan: `${SUBMODE_LABEL.plan} submode. Read-only architect: studies the codebase and submits an implementation plan for line-by-line review. The toolset narrows to read-only plus the spawn tools.`,
	grill: `${SUBMODE_LABEL.grill} submode. Read-only designer: interviews you to a shared understanding across a design tree before any plan or code exists.`,
	straight: `${SUBMODE_LABEL.straight} submode. Guided feature development: asks clarifying questions, explores the codebase, proposes designs, then implements with the code tools — web and job tools stay unavailable in every submode.`,
};
