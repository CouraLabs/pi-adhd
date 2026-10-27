import type { CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { AgentToolResult, ExtensionToolContext, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { askSingleQuestion, uiContextFromExtension } from "../../tools/ask-user/ask-legacy.ts";
import { showRichAskDialog } from "../../tools/ask-user/present-dialog.ts";
import { renderAskCall, renderAskResult } from "../../tools/ask-user/render.ts";
import type { AskToolDetails, ExtensionAskDialogQuestion, QuestionResult } from "../../tools/ask-user/types.ts";
import { allowedSdkToolsForActiveSubmode } from "./policy.ts";
import { toolResultBroker } from "./tool-result-broker.ts";

export const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion";

interface SdkAskOption {
	label: string;
	description?: string;
	preview?: string;
}

interface SdkAskQuestion {
	question: string;
	header?: string;
	options: SdkAskOption[];
	multiSelect?: boolean;
}

export type AskOutcome =
	| { kind: "answered"; answers: Record<string, string> }
	| { kind: "cancelled"; reason: string };

interface PendingAnswer {
	sessionKey: string | undefined;
	outcome: Promise<AskOutcome>;
	settle: (outcome: AskOutcome) => void;
}

export class AskAnswerBroker {
	private readonly pendingAnswers = new Map<string, PendingAnswer>();

	provide(toolUseId: string, outcome: AskOutcome): void {
		this.entryFor(toolUseId).settle(outcome);
	}

	async await(toolUseId: string, sessionKey: string, signal: AbortSignal | undefined): Promise<AskOutcome> {
		const entry = this.entryFor(toolUseId);
		entry.sessionKey = sessionKey;
		if (!signal) return entry.outcome;
		if (signal.aborted) return { kind: "cancelled", reason: "The question was aborted" };
		return new Promise<AskOutcome>((resolve) => {
			const onAbort = (): void => resolve({ kind: "cancelled", reason: "The question was aborted" });
			signal.addEventListener("abort", onAbort, { once: true });
			void entry.outcome.then((outcome) => {
				signal.removeEventListener("abort", onAbort);
				resolve(outcome);
			});
		});
	}

	forget(toolUseId: string): void {
		this.pendingAnswers.delete(toolUseId);
	}

	disposeSession(sessionKey: string, reason: string): void {
		for (const [toolUseId, entry] of [...this.pendingAnswers]) {
			if (entry.sessionKey !== sessionKey) continue;
			this.pendingAnswers.delete(toolUseId);
			entry.settle({ kind: "cancelled", reason });
		}
	}

	private entryFor(toolUseId: string): PendingAnswer {
		const existing = this.pendingAnswers.get(toolUseId);
		if (existing) return existing;
		let settle: (outcome: AskOutcome) => void = () => undefined;
		const outcome = new Promise<AskOutcome>((resolve) => {
			settle = resolve;
		});
		const created: PendingAnswer = { sessionKey: undefined, outcome, settle };
		this.pendingAnswers.set(toolUseId, created);
		return created;
	}
}

export const askAnswerBroker = new AskAnswerBroker();

function isAskUserQuestionAllowed(): boolean {
	const allowed = allowedSdkToolsForActiveSubmode();
	return allowed === undefined || allowed.has(ASK_USER_QUESTION_TOOL_NAME);
}

function updatedInputFor(input: Record<string, unknown>, outcome: AskOutcome): Record<string, unknown> {
	return outcome.kind === "answered" ? { ...input, answers: outcome.answers } : input;
}

export function createAskCanUseTool(sessionKey: string): CanUseTool {
	return async (toolName, input, { signal, toolUseID }) => {
		if (toolName !== ASK_USER_QUESTION_TOOL_NAME) return { behavior: "allow", updatedInput: input };
		const outcome = await askAnswerBroker.await(toolUseID, sessionKey, signal);
		if (outcome.kind === "cancelled") return { behavior: "deny", message: outcome.reason };
		return { behavior: "allow", updatedInput: updatedInputFor(input, outcome) };
	};
}

export function createAskPreToolUseHook(sessionKey: string): HookCallback {
	return async (input, _toolUseId, { signal }) => {
		if (input.hook_event_name !== "PreToolUse" || input.tool_name !== ASK_USER_QUESTION_TOOL_NAME) return {};
		if (!isAskUserQuestionAllowed()) return {};
		const outcome = await askAnswerBroker.await(input.tool_use_id, sessionKey, signal);
		if (outcome.kind === "cancelled") {
			return {
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: outcome.reason,
				},
			};
		}
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "allow",
				updatedInput: updatedInputFor(input.tool_input as Record<string, unknown>, outcome),
			},
		};
	};
}

function parseSdkQuestions(params: Record<string, unknown>): SdkAskQuestion[] {
	if (!Array.isArray(params.questions) || params.questions.length === 0) {
		throw new Error("AskUserQuestion: input has no questions");
	}
	return params.questions.map((candidate: unknown, index: number) => {
		const entry = candidate as Partial<SdkAskQuestion> | null;
		if (!entry || typeof entry.question !== "string" || !Array.isArray(entry.options)) {
			throw new Error(`AskUserQuestion: question ${index + 1} is malformed`);
		}
		return {
			question: entry.question,
			header: typeof entry.header === "string" ? entry.header : undefined,
			options: entry.options.map((option: SdkAskOption) => ({
				label: option.label,
				description: option.description,
				preview: option.preview,
			})),
			multiSelect: entry.multiSelect === true,
		};
	});
}

function toDialogQuestions(questions: SdkAskQuestion[]): ExtensionAskDialogQuestion[] {
	return questions.map((question, index) => ({
		id: `q${index + 1}`,
		question: question.question,
		...(question.header?.trim() ? { header: question.header } : {}),
		options: question.options.map((option) => ({
			label: option.label,
			...(option.description?.trim() ? { description: option.description.trim() } : {}),
			...(option.preview?.trim() ? { preview: option.preview } : {}),
		})),
		multi: question.multiSelect === true,
	}));
}

function answerTextOf(result: QuestionResult): string {
	const parts = [...result.selectedOptions];
	if (result.customInput !== undefined) parts.push(result.customInput);
	return parts.join(", ");
}

function hasAnswer(result: QuestionResult): boolean {
	return result.selectedOptions.length > 0 || result.customInput !== undefined || result.multi;
}

async function collectSequentially(
	ctx: ExtensionToolContext,
	questions: SdkAskQuestion[],
	signal: AbortSignal | undefined,
): Promise<QuestionResult[] | undefined> {
	const ui = uiContextFromExtension(ctx.ui);
	const results: QuestionResult[] = [];
	for (const [index, question] of questions.entries()) {
		const options = question.options.map((option) => ({
			label: option.label,
			...(option.description?.trim() ? { description: option.description.trim() } : {}),
		}));
		const selection = await askSingleQuestion(ui, question.question, options, question.multiSelect === true, { signal });
		if (selection.cancelled && !selection.timedOut) return undefined;
		results.push({
			id: `q${index + 1}`,
			question: question.question,
			options: options.map((option) => option.label),
			multi: question.multiSelect === true,
			selectedOptions: selection.selectedOptions,
			customInput: selection.customInput,
			timedOut: selection.timedOut || undefined,
		});
	}
	return results;
}

async function collectInRichDialog(
	ctx: ExtensionToolContext,
	questions: SdkAskQuestion[],
	signal: AbortSignal | undefined,
): Promise<QuestionResult[] | undefined> {
	const dialogResult = await showRichAskDialog(ctx.ui, toDialogQuestions(questions), { signal });
	if (!dialogResult) return undefined;
	if (dialogResult.results.length !== questions.length) {
		throw new Error("Ask dialog returned a result count that does not match the requested questions");
	}
	return dialogResult.results.map((result, index) => ({
		id: `q${index + 1}`,
		question: questions[index].question,
		options: questions[index].options.map((option) => option.label),
		multi: questions[index].multiSelect === true,
		selectedOptions: result.selectedOptions,
		customInput: result.customInput,
		timedOut: result.timedOut,
	}));
}

function toAskDetails(results: QuestionResult[]): AskToolDetails {
	if (results.length > 1) return { results };
	const [only] = results;
	return {
		question: only.question,
		options: only.options,
		multi: only.multi,
		selectedOptions: only.selectedOptions,
		customInput: only.customInput,
		timedOut: only.timedOut,
	};
}

async function relayResultFromSdk(
	toolCallId: string,
	signal: AbortSignal | undefined,
	details: AskToolDetails | undefined,
): Promise<AgentToolResult<AskToolDetails | undefined>> {
	const result = await toolResultBroker.wait(toolCallId, signal);
	return { content: result.content, details, ...(result.isError ? { isError: true } : {}) };
}

export async function executeAskMirror(
	toolCallId: string,
	params: Record<string, unknown>,
	signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
): Promise<AgentToolResult<AskToolDetails | undefined>> {
	let settled = false;
	const settle = (outcome: AskOutcome): void => {
		settled = true;
		askAnswerBroker.provide(toolCallId, outcome);
	};
	try {
		if (!isAskUserQuestionAllowed()) return await relayResultFromSdk(toolCallId, signal, undefined);
		if (!ctx.hasUI || !ctx.ui) {
			settle({
				kind: "cancelled",
				reason: "This session has no interactive UI, so the question was never shown to the user. Proceed with the safest default or state the questions in plain text.",
			});
			return await relayResultFromSdk(toolCallId, signal, undefined);
		}

		const questions = parseSdkQuestions(params);
		const results =
			ctx.mode === "tui"
				? await collectInRichDialog(ctx, questions, signal)
				: await collectSequentially(ctx, questions, signal);

		if (!results || results.some((result) => !hasAnswer(result))) {
			settle({ kind: "cancelled", reason: "The user dismissed the question without answering" });
			ctx.abort();
			throw new Error("Ask tool was cancelled by the user");
		}

		const answers: Record<string, string> = {};
		for (const result of results) answers[result.question] = answerTextOf(result);
		settle({ kind: "answered", answers });
		return await relayResultFromSdk(toolCallId, signal, toAskDetails(results));
	} finally {
		if (!settled) settle({ kind: "cancelled", reason: "The question could not be shown to the user" });
		askAnswerBroker.forget(toolCallId);
	}
}

export function askRenderers(): ToolRenderers {
	return {
		renderCall: (args, theme) => renderAskCall(args as { questions?: unknown }, theme),
		renderResult: (result, _options, theme) => renderAskResult(result, theme),
	};
}
