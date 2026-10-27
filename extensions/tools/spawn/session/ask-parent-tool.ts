import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const ASK_PARENT_TOOL_NAME = "ask_parent";

const RESULT_TEXT =
	"Question recorded for the delegating agent. End your turn now — it will answer by resuming you, and you will continue with your context intact.";

export type QuestionRecorder = (question: string) => void;

export class AskParentTool {
	constructor(private readonly record: QuestionRecorder) {}

	execute(
		_toolCallId: string,
		params: { question: string },
		_signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	) {
		this.record(params.question);

		return { content: [{ type: "text" as const, text: RESULT_TEXT }], details: undefined };
	}

	toToolDefinition() {
		return defineTool({
			name: ASK_PARENT_TOOL_NAME,
			label: "Ask Parent",
			promptSnippet: "Ask the delegating agent a question, then end your turn.",
			description:
				"Record a question for the agent that delegated this task. Use it when you cannot finish " +
				"without information only the delegating agent has, and the answer changes what you would do; " +
				"otherwise state your assumption and continue. After calling this, end your turn immediately — " +
				"the delegating agent answers by resuming you, and you continue with your context intact.",
			parameters: Type.Object({
				question: Type.String({
					description: "The question the delegating agent must answer before you can continue.",
				}),
			}),

			execute: (
				toolCallId: string,
				params: { question: string },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) => Promise.resolve(this.execute(toolCallId, params, signal, onUpdate, ctx)),
		});
	}
}
