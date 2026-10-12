/**
 * submodes — Plan, Grill, and Straight agent submodes for pi.
 *
 * A submode is additive: it *appends* two named prompt sections to whatever the
 * main mode (`shared/modes.ts`) already built — the submode prompt and a
 * generated tool policy, which is last — and sets the active tools to the
 * submode's whitelist. It never replaces the system prompt.
 *
 *   - Plan:  architect. Studies the codebase and submits a plan for
 *            line-by-line review through `plan-write`.
 *   - Grill: designer. Interviews the user to a shared understanding before
 *            any plan or code exists.
 *   - Straight: implementer. Asks clarifying questions, explores, proposes
 *            designs, then implements. The only submode that may change code, so
 *            it keeps the full toolset rather than the read-only whitelist.
 *
 * Enter with `/submode plan` / `/submode grill` / `/submode straight` (or toggle
 * with `/plan` / `/grill` / `/straight`); the model leaves or switches with the
 * `submode-exit` tool. The active submode is persisted in the pi-pack settings
 * file and restored on the next session.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { isGoalActive, switchBlockedByGoalMessage } from "../../../shared/interlock.ts";
import { loadSettings, updateSettings } from "../../../shared/settings.ts";
import {
	GRILL_SECTION,
	PLAN_SECTION,
	POLICY_SECTION,
	STRAIGHT_SECTION,
	SUBMODE_LABEL,
	SUBMODE_NAME,
	SUBMODE_NOTICE,
	SUBMODE_TOOLS,
	getSubmode,
	setSubmode,
	type ActiveSubmode,
	type Submode,
} from "../../../shared/submodes.ts";
import { createPlanWriteTool } from "./plan-write.ts";
import type { PlanLineComment, PlanVerdict } from "./plan-review.ts";
import { createSubmodeExitTool, type SubmodeExitMode } from "./submode-exit.ts";

// Prompts live as static .md assets next to this module (published with the
// package). Loaded at runtime: pi loads extensions through jiti, which does
// not support bundler-style text imports.
const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const planPrompt = readFileSync(path.join(promptsDir, "plan.md"), "utf8");
const grillPrompt = readFileSync(path.join(promptsDir, "grill.md"), "utf8");
const straightPrompt = readFileSync(path.join(promptsDir, "straight.md"), "utf8");

/**
 * Per-submode role sentence for the ACTIVE SUBMODE directive. A record rather
 * than a two-way ternary, so a new submode cannot silently inherit another's
 * role.
 */
const SUBMODE_ROLE: Record<ActiveSubmode, string> = {
	plan: "You are the architect: study the codebase, then submit a plan for review. Do not edit or write files.",
	grill: "You are the designer: interview the user to a shared understanding. Do not implement, write a plan, or edit files.",
	straight:
		"You are the implementer: ask clarifying questions, explore the codebase, propose designs, then implement the approved one.",
};

/** Per-submode handoff sentence: how the model leaves or moves on. */
const SUBMODE_HANDOFF: Record<ActiveSubmode, string> = {
	plan: "Submit the finished plan with `plan-write`; leave or switch with `submode-exit`.",
	grill: "Ask questions with `ask`; leave or switch with `submode-exit`.",
	straight: "Track the phases with `todo`; leave with `submode-exit` when the feature is done.",
};

/** The `submode-exit` result sentence for each switch target. */
const SUBMODE_SWITCH_RESULT: Record<ActiveSubmode, string> = {
	plan: "Switched to the Plan submode. The next run uses the architect prompt and the read-only tool set.",
	grill: "Switched to the Grill submode. The next run uses the designer prompt and the read-only tool set.",
	straight: "Switched to the Straight submode. The next run uses the guided implementer prompt and the full tool set.",
};

/** Description of the `/plan`, `/grill`, and `/straight` toggle commands. */
const TOGGLE_DESCRIPTION: Record<ActiveSubmode, string> = {
	plan: "Toggle the Plan submode",
	grill: "Toggle the Grill submode",
	straight: "Toggle the Straight submode",
};

/** The prompt section tag and loaded asset for each submode. */
const SUBMODE_PROMPTS: Record<ActiveSubmode, { section: string; prompt: string }> = {
	plan: { section: PLAN_SECTION, prompt: planPrompt },
	grill: { section: GRILL_SECTION, prompt: grillPrompt },
	straight: { section: STRAIGHT_SECTION, prompt: straightPrompt },
};

interface PendingPlan {
	markdown: string;
	verdict: PlanVerdict;
	comments: PlanLineComment[];
}

function isSubmode(value: unknown): value is Submode {
	return value === "none" || value === "plan" || value === "grill" || value === "straight";
}

export default function piSubmodesExtension(pi: ExtensionAPI): void {
	/** Active tools before the first submode was entered; restored on exit. */
	let savedTools: string[] | undefined;
	/** Whether this host can open a dialog; `ask-user` withdraws `ask` when it cannot. */
	let hasUI = true;
	/** The last plan submitted through `plan-write`, awaiting the model's exit. */
	let pendingPlan: PendingPlan | undefined;
	/** A plan whose approval asked for compaction before implementation. */
	let pendingCompactPlan: string | undefined;

	const applyTools = (submode: Submode) => {
		if (submode === "none") {
			if (savedTools !== undefined) {
				pi.setActiveTools(savedTools);
				savedTools = undefined;
			}
			return;
		}
		if (savedTools === undefined) savedTools = pi.getActiveTools();
		pi.setActiveTools(allowedTools(submode));
	};

	/** Enter a submode and persist it. Returns false when goal mode blocks the switch. */
	const enterSubmode = (submode: ActiveSubmode): boolean => {
		if (isGoalActive()) return false;
		setSubmode(submode);
		applyTools(submode);
		updateSettings({ submodes: { current: submode } });
		return true;
	};

	const exitSubmode = () => {
		setSubmode("none");
		applyTools("none");
		updateSettings({ submodes: { current: "none" } });
	};

	/** Toggle a submode on, or off when it is already active. Returns false when
	 *  goal mode blocks entering. */
	const toggleSubmode = (submode: ActiveSubmode): boolean => {
		if (getSubmode() === submode) {
			exitSubmode();
			return true;
		}
		return enterSubmode(submode);
	};

	const transition = (mode: SubmodeExitMode, ctx: ExtensionToolContext): string => {
		if (mode !== "exit") {
			if (!enterSubmode(mode)) return switchBlockedByGoalMessage();
			ctx.ui.notify(SUBMODE_NOTICE[mode], "info");
			return SUBMODE_SWITCH_RESULT[mode];
		}

		const plan = pendingPlan;
		pendingPlan = undefined;
		exitSubmode();
		ctx.ui.notify(SUBMODE_NOTICE.none, "info");

		if (plan && plan.verdict === "approve-compact") {
			pendingCompactPlan = plan.markdown;
			return "Submode exited. The session will be compacted, then the approved plan is sent as the next prompt.";
		}
		if (plan && plan.verdict === "approve") {
			pi.sendUserMessage(`Implement the approved plan below.\n\n${plan.markdown}`, { deliverAs: "followUp" });
			return "Submode exited. The approved plan is queued as the next prompt; implementation begins in a fresh run.";
		}
		return "Submode exited. Back to the normal coder agent.";
	};

	pi.registerTool(
		createPlanWriteTool({
			store: (markdown, verdict, comments) => {
				pendingPlan = { markdown, verdict, comments };
			},
		}),
	);
	pi.registerTool(createSubmodeExitTool({ transition }));

	/**
	 * The whitelist for a submode, minus the tools this host cannot serve: `ask`
	 * opens a dialog, so `ask-user` withdraws it when there is no UI. Re-adding it
	 * here would offer the model a tool that fails on call.
	 */
	const allowedTools = (submode: ActiveSubmode): string[] => {
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		return SUBMODE_TOOLS[submode].filter((name) => registered.has(name) && (hasUI || name !== "ask"));
	};

	/** Every registered tool the active submode forbids, sorted for a stable prompt. */
	const forbiddenTools = (submode: ActiveSubmode): string[] => {
		const allowed = new Set(allowedTools(submode));
		return pi
			.getAllTools()
			.map((tool) => tool.name)
			.filter((name) => !allowed.has(name))
			.sort();
	};

	/**
	 * A concise directive naming the active submode, its role, and the handoff tool.
	 * Prepended to the submode section so the model knows which submode it is in
	 * regardless of the main Pi/Work mode.
	 */
	const submodeDirective = (submode: ActiveSubmode): string => {
		return [
			`ACTIVE SUBMODE: ${SUBMODE_NAME[submode]}.`,
			SUBMODE_ROLE[submode],
			SUBMODE_HANDOFF[submode],
		].join(" ");
	};

	/**
	 * The tool policy for the run, emitted as the last section of the system prompt.
	 * The main mode may replace the preamble with prose naming tools this submode
	 * forbids (`work.md` names `todo`, `edit`, and `write`), so the policy states the
	 * allowed set and every forbidden name outright.
	 */
	const toolPolicy = (submode: ActiveSubmode): string => {
		const allowed = allowedTools(submode);
		const forbidden = forbiddenTools(submode);
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
	};

	// Append the submode prompt sections and set the active tool set for the run.
	// Sections are additive, so the main mode's prompt is untouched. The policy
	// section is inserted last so it is the final text of the system prompt.
	pi.on("before_agent_start", (event) => {
		const { sections } = event.systemPromptOptions;
		delete sections[PLAN_SECTION];
		delete sections[GRILL_SECTION];
		delete sections[STRAIGHT_SECTION];
		delete sections[POLICY_SECTION];
		const submode = getSubmode();
		if (submode === "none") return;

		// Re-assert the whitelist every run: another extension can widen the active set
		// between runs (`goal` restores a list it saved before the submode narrowed it),
		// and the policy must match the tools actually offered.
		const allowed = allowedTools(submode);
		pi.setActiveTools(allowed);
		event.systemPromptOptions.selectedTools = allowed;

		const entry = SUBMODE_PROMPTS[submode];
		sections[entry.section] = `${submodeDirective(submode)}\n\n${entry.prompt}`;
		sections[POLICY_SECTION] = toolPolicy(submode);
	});

	pi.on("session_start", (_event, ctx) => {
		hasUI = ctx.hasUI;
		const stored = loadSettings().submodes.current;
		const submode = isSubmode(stored) ? stored : "none";
		if (submode === "none") {
			setSubmode("none");
			applyTools("none");
		} else {
			if (savedTools === undefined) savedTools = pi.getActiveTools();
			setSubmode(submode);
			pi.setActiveTools(allowedTools(submode));
		}
	});

	// "Approve and Compact": the tool ended the run, so compact now (idle) and
	// send the plan once compaction completes, starting the coder run.
	pi.on("agent_settled", (_event, ctx) => {
		if (!pendingCompactPlan) return;
		const plan = pendingCompactPlan;
		pendingCompactPlan = undefined;
		setTimeout(() => {
			ctx.compact({
				customInstructions: "Preserve the approved implementation plan and the decisions that led to it.",
				onComplete: () => {
					pi.sendUserMessage(`Implement the approved plan below.\n\n${plan}`);
				},
				onError: (error) => {
					ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
				},
			});
		}, 0);
	});

	pi.registerCommand("submode", {
		description: "Switch agent submode (usage: /submode [none|plan|grill|straight])",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "plan" || arg === "grill" || arg === "straight") {
				if (!enterSubmode(arg)) {
					ctx.ui.notify(switchBlockedByGoalMessage(), "warning");
					return;
				}
				ctx.ui.notify(SUBMODE_NOTICE[arg], "info");
				return;
			}
			if (arg === "none" || arg === "exit") {
				exitSubmode();
				ctx.ui.notify(SUBMODE_NOTICE.none, "info");
				return;
			}
			if (arg === "") {
				ctx.ui.notify(`Submode: ${SUBMODE_LABEL[getSubmode()] || "none"}`, "info");
				return;
			}
			ctx.ui.notify("Usage: /submode [none|plan|grill|straight]", "warning");
		},
	});

	for (const submode of ["plan", "grill", "straight"] as const) {
		pi.registerCommand(submode, {
			description: TOGGLE_DESCRIPTION[submode],
			handler: async (_args, ctx) => {
				if (!toggleSubmode(submode)) {
					ctx.ui.notify(switchBlockedByGoalMessage(), "warning");
					return;
				}
				ctx.ui.notify(getSubmode() === submode ? SUBMODE_NOTICE[submode] : SUBMODE_NOTICE.none, "info");
			},
		});
	}
}
