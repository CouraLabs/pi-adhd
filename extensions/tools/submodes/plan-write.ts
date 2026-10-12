/**
 * plan-write.ts — the `plan-write` tool.
 *
 * The Plan agent's terminal action: it submits the complete plan, which the
 * extension renders fullscreen for line-by-line review. The verdict returns as
 * the tool result:
 *
 *   - approve / approve-compact → the model calls `submode-exit` to hand off.
 *   - reject → the run ends and the user's line comments are returned.
 */

import type { ExtensionToolContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { showPlanReview, type PlanLineComment, type PlanVerdict } from "./plan-review.ts";

/** Callback the extension uses to remember the reviewed plan and its verdict. */
export interface PlanWriteDeps {
	store: (plan: string, verdict: PlanVerdict, comments: PlanLineComment[]) => void;
}

interface PlanWriteDetails {
	verdict: PlanVerdict;
	comments: PlanLineComment[];
}

const DESCRIPTION = `Submit the complete implementation plan for user review.

The plan is rendered fullscreen, line by line. The user reads it, may attach comments to any line, and returns one of three verdicts:
- approve: implement the plan. Call \`submode-exit\` with \`mode: "exit"\` as your next action.
- approve-compact: the session is compacted, then the plan is sent back as the next prompt.
- reject: the run ends and the user's line comments are returned to you. Revise the plan and submit it again.

Do not also write the plan out in your reply; the tool renders it. Do not write or edit any file while you are still the Plan agent.`;

function formatComments(comments: PlanLineComment[]): string {
	if (comments.length === 0) return "";
	return comments.map((comment) => `- line ${comment.line}: ${comment.text}`).join("\n");
}

/** Rendered plan lines shown inline while the plan streams (thinking-style tail). */
const PLAN_PREVIEW_LINES = 10;

/**
 * Inline plan preview for the tool call. Renders the heading and the tail of the
 * plan as it streams, capped at `PLAN_PREVIEW_LINES` rendered lines (all when
 * expanded), matching the compact-thinking preview. Reused across renders so the
 * TUI keeps one component identity.
 */
class PlanCallComponent implements Component {
	private plan = "";
	private theme: Theme | undefined;
	private expanded = false;
	private streaming = false;

	update(plan: string, theme: Theme, expanded: boolean, streaming: boolean): void {
		this.plan = plan;
		this.theme = theme;
		this.expanded = expanded;
		this.streaming = streaming;
	}

	render(width: number): string[] {
		const theme = this.theme;
		if (!theme) return [];
		const status = this.streaming ? theme.fg("muted", " · writing…") : "";
		const heading = `${theme.fg("toolTitle", theme.bold("Plan"))}${status}`;

		const body = this.plan.replace(/\r\n?/g, "\n").trimEnd();
		if (body.trim() === "") return new Text(heading, 0, 0).render(width);

		const lines = new Text(theme.fg("toolOutput", body), 0, 0).render(width);
		const max = this.expanded ? lines.length : PLAN_PREVIEW_LINES;
		const truncated = lines.length > max;
		const shown = truncated ? lines.slice(lines.length - max) : lines;
		const hidden = lines.length - shown.length;
		const hint = truncated
			? ` ${theme.fg("muted", `(${hidden} more ${hidden === 1 ? "line" : "lines"})`)}`
			: "";
		return [...new Text(`${heading}${hint}`, 0, 0).render(width), ...shown];
	}

	invalidate(): void {}
}

export function createPlanWriteTool(deps: PlanWriteDeps): ToolDefinition {
	return defineTool({
		name: "plan-write",
		label: "Write Plan",
		description: DESCRIPTION,
		promptSnippet: "Submit the implementation plan for user review",
		exposure: "direct",
		defaultActive: false,
		executionMode: "sequential",
		parameters: Type.Object({
			plan: Type.String({ description: "The complete implementation plan, in Markdown." }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionToolContext) {
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				throw new Error(
					"plan-write needs the interactive TUI to show the plan for review; this session has no UI host.",
				);
			}

			const plan = params.plan;
			const result = await showPlanReview(ctx.ui, plan, signal);
			if (!result) {
				ctx.abort();
				throw new Error("Plan review was cancelled.");
			}

			deps.store(plan, result.verdict, result.comments);
			const details: PlanWriteDetails = { verdict: result.verdict, comments: result.comments };

			if (result.verdict === "reject") {
				const comments = formatComments(result.comments);
				const text = [
					"The user rejected the plan. Stop now and wait for the user's next instruction.",
					comments ? `\nLine comments to address:\n${comments}` : "",
				].join("");
				return { content: [{ type: "text" as const, text }], details, terminate: true };
			}

			const text =
				result.verdict === "approve-compact"
					? 'The user approved the plan with compaction. Call `submode-exit` with `mode: "exit"` as your next action; the session will be compacted and the plan sent as the next prompt.'
					: 'The user approved the plan. Call `submode-exit` with `mode: "exit"` as your next action; implementation will begin in a fresh run.';
			return { content: [{ type: "text" as const, text }], details };
		},
		renderCall(args, theme, context) {
			const component =
				(context.lastComponent as PlanCallComponent | undefined) ?? new PlanCallComponent();
			const plan = typeof args?.plan === "string" ? args.plan : "";
			component.update(plan, theme, context.expanded, !context.argsComplete);
			return component;
		},
		renderResult(result, _options, theme) {
			const details = result.details as PlanWriteDetails | undefined;
			if (!details) {
				const text = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(text, 0, 0);
			}
			const verdict =
				details.verdict === "approve"
					? theme.fg("success", "approved")
					: details.verdict === "approve-compact"
						? theme.fg("success", "approved · compact")
						: theme.fg("error", "rejected");
			const commentCount =
				details.comments.length > 0
					? theme.fg("dim", ` · ${details.comments.length} comment${details.comments.length === 1 ? "" : "s"}`)
					: "";
			return new Text(`${theme.fg("muted", "Plan review → ")}${verdict}${commentCount}`, 0, 0);
		},
	});
}
