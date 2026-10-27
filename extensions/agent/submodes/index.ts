import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { isClaudeProvider } from "../../../shared/modes.ts";
import { toSdkToolName } from "../../providers/claude/policy.ts";
import { isMirroredSdkTool } from "../../providers/claude/sdk-tools.ts";
import { retargetToolSet } from "../../providers/claude/tool-swap.ts";
import { offloadPrompt } from "../../../shared/user-prompts.ts";
import {
	GRILL_SECTION,
	PLAN_SECTION,
	POLICY_SECTION,
	STRAIGHT_SECTION,
	SUBMODE_LABEL,
	SUBMODE_NOTICE,
	SUBMODE_PROMPT_FILE,
	SUBMODE_SECTION,
	SUBMODE_STATE_ENTRY_TYPE,
	SUBMODE_TOOLS,
	formatToolPolicy,
	getSubmode,
	packagedSubmodePrompt,
	readSubmodePrompt,
	submodeDirective,
	restoreSubmodeFromEntries,
	setSubmode,
	type ActiveSubmode,
	type Submode,
} from "../../../shared/submodes.ts";
import { createPlanWriteTool, formatComments } from "./plan-write.ts";
import type { PlanLineComment, PlanVerdict } from "./plan-review.ts";
import { createSubmodeExitTool, type SubmodeExitMode } from "./submode-exit.ts";

const SUBMODE_SWITCH_RESULT: Record<ActiveSubmode, string> = {
	plan: "Switched to the Plan submode. The next run uses the architect prompt and the read-only tool set.",
	grill: "Switched to the Grill submode. The next run uses the designer prompt and the read-only tool set.",
	straight: "Switched to the Straight submode. The next run uses the guided implementer prompt and the full tool set.",
};

const SUBMODE_KICKOFF_PROMPT: Record<ActiveSubmode, string> = {
	plan: "The design is settled. Continue in the Plan submode and produce the implementation plan now.",
	grill: "Continue in the Grill submode and resume the design interview.",
	straight: "The design is approved. Continue in the Straight submode and implement it now.",
};

const TOGGLE_DESCRIPTION: Record<ActiveSubmode, string> = {
	plan: "Toggle the Plan submode",
	grill: "Toggle the Grill submode",
	straight: "Toggle the Straight submode",
};

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

type PendingHandoff =
	| { kind: "switch"; mode: ActiveSubmode }
	| { kind: "plan"; markdown: string };

export default function piSubmodesExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("submodes");

	for (const submode of Object.keys(SUBMODE_PROMPT_FILE) as ActiveSubmode[]) {
		offloadPrompt("submodes", SUBMODE_PROMPT_FILE[submode], packagedSubmodePrompt(submode));
	}

	let savedTools: string[] | undefined;

	let hasUI = true;

	let childSession = false;

	let claudeActive = false;

	let pendingPlan: PendingPlan | undefined;

	let pendingCompactPlan: string | undefined;

	let pendingHandoff: PendingHandoff | undefined;

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

	const enterSubmode = (submode: ActiveSubmode): void => {
		if (getSubmode() === submode) return;
		setSubmode(submode);
		applyTools(submode);
		pi.appendEntry(SUBMODE_STATE_ENTRY_TYPE, { submode });
	};

	const exitSubmode = () => {
		if (getSubmode() === "none") return;
		setSubmode("none");
		applyTools("none");
		pi.appendEntry(SUBMODE_STATE_ENTRY_TYPE, { submode: "none" });
	};

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

	const toggleSubmode = (submode: ActiveSubmode): void => {
		if (getSubmode() === submode) {
			exitSubmode();
			return;
		}
		enterSubmode(submode);
	};

	const transition = (mode: SubmodeExitMode, ctx: ExtensionToolContext): string => {
		if (mode !== "exit") {
			enterSubmode(mode);
			ctx.ui.notify(SUBMODE_NOTICE[mode], "info");

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

	const allowedTools = (submode: ActiveSubmode): string[] => {
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		const permitted = SUBMODE_TOOLS[submode].filter((name) => hasUI || name !== "ask");
		if (!claudeActive) return permitted.filter((name) => registered.has(name));
		const claudeNames = permitted.map((name) => {
			const sdkName = toSdkToolName(name);
			return isMirroredSdkTool(sdkName) && registered.has(sdkName) ? sdkName : name;
		});
		if (registered.has("Skill")) claudeNames.push("Skill");
		return [...new Set(claudeNames)].filter((name) => registered.has(name));
	};

	const forbiddenTools = (submode: ActiveSubmode): string[] => {
		const allowed = new Set(allowedTools(submode));
		return pi
			.getAllTools()
			.map((tool) => tool.name)
			.filter((name) => !allowed.has(name))
			.sort();
	};

	const toolPolicy = (submode: ActiveSubmode): string =>
		formatToolPolicy(submode, allowedTools(submode), forbiddenTools(submode));

	pi.on("before_agent_start", (event) => {
		if (childSession) return;
		const { sections } = event.systemPromptOptions;
		delete sections[PLAN_SECTION];
		delete sections[GRILL_SECTION];
		delete sections[STRAIGHT_SECTION];
		delete sections[POLICY_SECTION];
		const submode = getSubmode();
		if (submode === "none") return;

		const allowed = allowedTools(submode);
		pi.setActiveTools(allowed);
		event.systemPromptOptions.selectedTools = allowed;

		sections[SUBMODE_SECTION[submode]] = `${submodeDirective(submode)}\n\n${readSubmodePrompt(submode)}`;
		sections[POLICY_SECTION] = toolPolicy(submode);
	});

	pi.on("session_start", (_event, ctx) => {
		hasUI = ctx.hasUI;
		claudeActive = isClaudeProvider(ctx.model?.provider);
		childSession = isChildSession(ctx.sessionManager.getSessionId());

		savedTools = undefined;
		pendingPlan = undefined;
		pendingCompactPlan = undefined;
		pendingHandoff = undefined;
		if (childSession) return;
		restoreSubmode(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (childSession) return;
		restoreSubmode(ctx);
	});

	pi.on("model_select", (event) => {
		if (childSession) return;
		const nowClaude = isClaudeProvider(event.model.provider);
		if (nowClaude === claudeActive) return;
		claudeActive = nowClaude;
		if (savedTools !== undefined) {
			savedTools = retargetToolSet(savedTools, new Set(pi.getAllTools().map((tool) => tool.name)), nowClaude);
		}
		const submode = getSubmode();
		if (submode !== "none") pi.setActiveTools(allowedTools(submode));
	});

	pi.on("session_shutdown", () => {
		savedTools = undefined;
		pendingPlan = undefined;
		pendingCompactPlan = undefined;
		pendingHandoff = undefined;
		childSession = false;
	});

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
				enterSubmode(arg);
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
				toggleSubmode(submode);
				ctx.ui.notify(getSubmode() === submode ? SUBMODE_NOTICE[submode] : SUBMODE_NOTICE.none, "info");
			},
		});
	}
}
