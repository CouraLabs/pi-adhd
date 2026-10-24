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
 * `submode-exit` tool. The submode is session-scoped: every switch is
 * snapshotted into a `submode-state` session entry and restored from the current
 * branch on session start, so two pi instances (or two sessions in one process)
 * never share a submode and a value cannot leak through the shared settings
 * file.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { isGoalActive, switchBlockedByGoalMessage } from "../../../shared/interlock.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { offloadPrompt, readUserPrompt } from "../../../shared/user-prompts.ts";
import {
	GRILL_SECTION,
	PLAN_SECTION,
	POLICY_SECTION,
	STRAIGHT_SECTION,
	SUBMODE_LABEL,
	SUBMODE_NAME,
	SUBMODE_NOTICE,
	SUBMODE_STATE_ENTRY_TYPE,
	SUBMODE_TOOLS,
	getSubmode,
	restoreSubmodeFromEntries,
	setSubmode,
	type ActiveSubmode,
	type Submode,
} from "../../../shared/submodes.ts";
import { createPlanWriteTool, formatComments } from "./plan-write.ts";
import type { PlanLineComment, PlanVerdict } from "./plan-review.ts";
import { createSubmodeExitTool, type SubmodeExitMode } from "./submode-exit.ts";

// Prompts live as static .md assets next to this module (published with the
// package). Loaded at runtime: pi loads extensions through jiti, which does
// not support bundler-style text imports. These are the packaged fallbacks:
// at load time the extension copies each to
// ~/.pi/couralabs/prompts/submodes/<name>.md (once) and reads the prompt from
// there on every run, so user edits apply without touching the package.
const promptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const packagedPlanPrompt = readFileSync(path.join(promptsDir, "plan.md"), "utf8");
const packagedGrillPrompt = readFileSync(path.join(promptsDir, "grill.md"), "utf8");
const packagedStraightPrompt = readFileSync(path.join(promptsDir, "straight.md"), "utf8");

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
	straight: "Work the phases to a finished feature; leave with `submode-exit` when the user has the result.",
};

/** The `submode-exit` result sentence for each switch target. */
const SUBMODE_SWITCH_RESULT: Record<ActiveSubmode, string> = {
	plan: "Switched to the Plan submode. The next run uses the architect prompt and the read-only tool set.",
	grill: "Switched to the Grill submode. The next run uses the designer prompt and the read-only tool set.",
	straight: "Switched to the Straight submode. The next run uses the guided implementer prompt and the full tool set.",
};

/**
 * Kickoff text for the hidden message that starts the target submode's run after
 * a switch. The target submode's own prompt carries the detailed instructions;
 * this only hands the conversation over so the new run has something to act on.
 */
const SUBMODE_KICKOFF_PROMPT: Record<ActiveSubmode, string> = {
	plan: "The design is settled. Continue in the Plan submode and produce the implementation plan now.",
	grill: "Continue in the Grill submode and resume the design interview.",
	straight: "The design is approved. Continue in the Straight submode and implement it now.",
};

/** Description of the `/plan`, `/grill`, and `/straight` toggle commands. */
const TOGGLE_DESCRIPTION: Record<ActiveSubmode, string> = {
	plan: "Toggle the Plan submode",
	grill: "Toggle the Grill submode",
	straight: "Toggle the Straight submode",
};

/** The prompt section tag and packaged fallback asset for each submode. */
const SUBMODE_PROMPTS: Record<ActiveSubmode, { section: string; file: string; packaged: string }> = {
	plan: { section: PLAN_SECTION, file: "plan.md", packaged: packagedPlanPrompt },
	grill: { section: GRILL_SECTION, file: "grill.md", packaged: packagedGrillPrompt },
	straight: { section: STRAIGHT_SECTION, file: "straight.md", packaged: packagedStraightPrompt },
};

/**
 * Append the reviewer's line comments to an approved plan, so both approval
 * paths (implement now, implement after compaction) carry them into the run
 * that implements the plan. A reject delivers comments through the tool result
 * instead, so it never calls this.
 */
const planWithComments = (plan: PendingPlan): string => {
	const comments = formatComments(plan.comments);
	if (!comments) return plan.markdown;
	return `${plan.markdown.trimEnd()}\n\n## Reviewer comments\n\n${comments}\n`;
};

interface PendingPlan {
	markdown: string;
	verdict: PlanVerdict;
	comments: PlanLineComment[];
}

/**
 * A run to start once the current one settles, so the target mode's
 * `before_agent_start` applies before it runs. A `switch` starts a hidden
 * kickoff run in the target submode; `plan` sends the approved plan as a user
 * turn in the normal coder mode.
 */
type PendingHandoff =
	| { kind: "switch"; mode: ActiveSubmode }
	| { kind: "plan"; markdown: string };

export default function piSubmodesExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("submodes");

	// Offload the packaged prompts to the editable user folder (no-op when they
	// are already there) so the user can edit them; every run then reads those
	// files.
	for (const entry of Object.values(SUBMODE_PROMPTS)) {
		offloadPrompt("submodes", entry.file, entry.packaged);
	}
	/** Active tools before the first submode was entered; restored on exit. */
	let savedTools: string[] | undefined;
	/** Whether this host can open a dialog; `ask-user` withdraws `ask` when it cannot. */
	let hasUI = true;
	/** Whether this instance belongs to a spawned child session, which stays
	 *  inert so it never narrows the parent's tool set or appends the parent's
	 *  prompt sections to its own run. */
	let childSession = false;
	/** The last plan submitted through `plan-write`, awaiting the model's exit. */
	let pendingPlan: PendingPlan | undefined;
	/** A plan whose approval asked for compaction before implementation. */
	let pendingCompactPlan: string | undefined;
	/** A submode switch or approved plan waiting for the current run to settle. */
	let pendingHandoff: PendingHandoff | undefined;

	/** Snapshot the active tool set for later restore, minus tools this host
	 *  cannot serve: `ask-user` withdraws `ask` on a no-UI host, and a snapshot
	 *  taken before that strip would hand the model a tool whose execute
	 *  backstop throws. */
	const captureSavedTools = (): string[] => pi.getActiveTools().filter((name) => hasUI || name !== "ask");

	const applyTools = (submode: Submode) => {
		if (submode === "none") {
			if (savedTools !== undefined) {
				pi.setActiveTools(savedTools);
				savedTools = undefined;
			}
			return;
		}
		if (savedTools === undefined) savedTools = captureSavedTools();
		pi.setActiveTools(allowedTools(submode));
	};

	/** Enter a submode and snapshot it into the session. Returns false when goal
	 *  mode blocks the switch. */
	const enterSubmode = (submode: ActiveSubmode): boolean => {
		if (isGoalActive()) return false;
		if (getSubmode() === submode) return true;
		setSubmode(submode);
		applyTools(submode);
		pi.appendEntry(SUBMODE_STATE_ENTRY_TYPE, { submode });
		return true;
	};

	const exitSubmode = () => {
		if (getSubmode() === "none") return;
		setSubmode("none");
		applyTools("none");
		pi.appendEntry(SUBMODE_STATE_ENTRY_TYPE, { submode: "none" });
	};

	/** Restore the branch-local submode: the latest valid snapshot wins, else
	 *  `none`. Called on session start and tree navigation. */
	const restoreSubmode = (ctx: ExtensionContext): void => {
		const submode = restoreSubmodeFromEntries(ctx.sessionManager.getBranch()) ?? "none";
		if (submode === "none") {
			setSubmode("none");
			applyTools("none");
			return;
		}
		if (savedTools === undefined) savedTools = captureSavedTools();
		setSubmode(submode);
		pi.setActiveTools(allowedTools(submode));
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
			// The tool ends this run, so the target submode takes effect in the next one,
			// started from the `agent_settled` handler. Queueing a follow-up here would
			// drain inside this run, which keeps the previous submode's system prompt.
			pendingHandoff = { kind: "switch", mode };
			return SUBMODE_SWITCH_RESULT[mode];
		}

		const plan = pendingPlan;
		pendingPlan = undefined;
		exitSubmode();
		ctx.ui.notify(SUBMODE_NOTICE.none, "info");

		if (plan && plan.verdict === "approve-compact") {
			pendingCompactPlan = planWithComments(plan);
			return "Submode exited. The session will be compacted, then the approved plan is sent as the next prompt.";
		}
		if (plan && plan.verdict === "approve") {
			// Start the coder run after this one settles, so the normal prompt and full
			// toolset apply; a same-run follow-up would still carry the Plan prompt.
			pendingHandoff = { kind: "plan", markdown: planWithComments(plan) };
			return "Submode exited. The approved plan starts the next run; implementation begins there.";
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
	 * forbids (`work.md` names `edit` and `write`), so the policy states the
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
		if (childSession) return;
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
		sections[entry.section] = `${submodeDirective(submode)}\n\n${readUserPrompt("submodes", entry.file, entry.packaged)}`;
		sections[POLICY_SECTION] = toolPolicy(submode);
	});

	pi.on("session_start", (_event, ctx) => {
		hasUI = ctx.hasUI;
		childSession = isChildSession(ctx.sessionManager.getSessionId());
		// A new session starts clean: no plan, handoff, or saved tool set carries
		// over from the previous one in this process.
		savedTools = undefined;
		pendingPlan = undefined;
		pendingCompactPlan = undefined;
		pendingHandoff = undefined;
		if (childSession) return;
		restoreSubmode(ctx);
	});

	// Tree navigation restores the submode recorded on the branch the user landed
	// on, so a fork back to an earlier point does not keep the abandoned branch's
	// submode or tool set.
	pi.on("session_tree", (_event, ctx) => {
		if (childSession) return;
		restoreSubmode(ctx);
	});

	pi.on("session_shutdown", () => {
		savedTools = undefined;
		pendingPlan = undefined;
		pendingCompactPlan = undefined;
		pendingHandoff = undefined;
		childSession = false;
	});

	// A submode switch and an approved plan both need a fresh run so the target
	// mode's `before_agent_start` applies. The `submode-exit` tool ends the current
	// run, so start the next one here, once the run has settled. Starting it as a
	// same-run follow-up would keep the previous submode's prompt and tool policy.
	pi.on("agent_settled", (event, ctx) => {
		if (pendingHandoff) {
			const handoff = pendingHandoff;
			pendingHandoff = undefined;
			if (event.aborted) return;
			if (handoff.kind === "switch") {
				pi.sendMessage(
					{ customType: "submode-handoff", content: SUBMODE_KICKOFF_PROMPT[handoff.mode], display: false },
					{ triggerTurn: true },
				);
			} else {
				pi.sendUserMessage(`Implement the approved plan below.\n\n${handoff.markdown}`);
			}
			return;
		}
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
