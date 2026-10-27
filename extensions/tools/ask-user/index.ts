import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { showRichAskDialog } from "./present-dialog.ts";
import { renderAskCall, renderAskResult } from "./render.ts";
import {
	askSingleQuestion,
	RESERVED_OPTION_LABELS,
	type AskOption,
	type NavigationControls,
	type UIContext,
	uiContextFromExtension,
} from "./ask-legacy.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import type {
	AskToolDetails,
	ExtensionAskDialogQuestion,
	ExtensionAskDialogResult,
	QuestionResult,
} from "./types.ts";

const OptionSchema = Type.Object({
	label: Type.String({ description: "display label" }),
	description: Type.Optional(Type.String({ description: "optional explanatory text displayed below the label" })),
	preview: Type.Optional(
		Type.String({ description: "optional rich preview content for interactive ask dialogs" }),
	),
});

const AskQuestionSchema = Type.Object({
	id: Type.String({ description: "question id" }),
	question: Type.String({ description: "question text" }),
	header: Type.Optional(Type.String({ description: "optional short display chip for rich ask dialogs" })),
	options: Type.Array(OptionSchema, { description: "available options" }),
	multi: Type.Optional(Type.Boolean({ description: "allow multiple selections" })),
	recommended: Type.Optional(Type.Integer({ minimum: 0, description: "recommended option index" })),
});

const AskParamsSchema = Type.Object({
	questions: Type.Array(AskQuestionSchema, { minItems: 1, description: "questions to ask" }),
	timeoutSeconds: Type.Optional(
		Type.Integer({
			minimum: 1,
			description:
				"Inactivity timeout in seconds for the whole dialog; keypresses in the dialog reset it " +
				"(not while typing an Other answer, and not on hosts limited to plain sequential " +
				"dialogs). On expiry unanswered questions auto-pick the recommended option " +
				"(omp's settings-driven ask.timeout, parameterized for pi)",
		}),
	),
});

interface AskParams {
	questions: Array<{
		id: string;
		question: string;
		header?: string;
		options: Array<{ label: string; description?: string; preview?: string }>;
		multi?: boolean;
		recommended?: number;
	}>;
	timeoutSeconds?: number;
}

const ASK_DESCRIPTION = `Ask user for clarification/input during task execution.

<conditions>
- Multiple approaches with significantly different tradeoffs user should weigh.
</conditions>

<instruction>
- \`recommended: <index>\` marks default (0-indexed); " (Recommended)" added automatically.
- Use \`questions\` for related questions, not one at a time.
- Set \`multi: true\` on a question to allow multiple selections.
- Short option labels; explanatory tradeoffs in \`description\`, not labels.
</instruction>

<caution>
- Provide 2-5 concise, distinct options.
</caution>

<critical>
- Default to action. Resolve ambiguity via repo conventions, existing patterns, reasonable defaults. Exhaust existing sources (code, configs, docs, history) before asking. Ask only when options have materially different tradeoffs the user must decide.
- If multiple choices acceptable: pick most conservative/standard option; proceed; state choice.
- Do NOT include "Other"; UI automatically adds "Other (type your own)" to every question.
</critical>`;

function formatQuestionResult(result: QuestionResult): string {
	if (result.customInput !== undefined) {
		return `${result.id}: "${result.customInput}"`;
	}
	if (result.selectedOptions.length > 0) {
		const suffix = result.timedOut ? " (auto-selected after timeout)" : "";
		return result.multi
			? `${result.id}: [${result.selectedOptions.join(", ")}]${suffix}`
			: `${result.id}: ${result.selectedOptions[0]}${suffix}`;
	}
	return result.multi ? `${result.id}: []` : `${result.id}: (cancelled)`;
}

function formatSingleQuestionResponse(result: {
	selectedOptions: string[];
	customInput?: string;
	timedOut?: boolean;
	multi: boolean;
}): string {
	const responseParts: string[] = [];
	if (result.selectedOptions.length > 0) {
		const selectedText = result.multi
			? `User selected: ${result.selectedOptions.join(", ")}`
			: `User selected: ${result.selectedOptions[0]}`;
		responseParts.push(result.timedOut ? `${selectedText} (auto-selected after timeout)` : selectedText);
	}
	if (result.customInput !== undefined) {
		responseParts.push(
			result.customInput.includes("\n")
				? `User provided custom input:\n${result.customInput
						.split("\n")
						.map(line => `  ${line}`)
						.join("\n")}`
				: `User provided custom input: ${result.customInput}`,
		);
	}
	if (responseParts.length > 0) return responseParts.join("\n");
	return result.multi ? "User did not select any options" : "User cancelled the selection";
}

export default function ompAskExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("ask-user");
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: ASK_DESCRIPTION,

		exposure: "model-only",
		promptSnippet: "Ask the user a clarifying question",
		promptGuidelines: [
			"Use ask only after exhausting repo conventions, configs, and docs; reserve it for decisions whose options have materially different tradeoffs.",
		],
		parameters: AskParamsSchema,
		executionMode: "sequential",

		async execute(_toolCallId, params: AskParams, signal, _onUpdate, ctx) {

			if (!ctx.hasUI || !ctx.ui) {
				ctx.abort();
				throw new Error(
					"ask: this session has no interactive UI host, so the question was never shown to the user. " +
						"Do not call ask again in this session; proceed with the safest default or state questions in plain text.",
				);
			}

			for (const q of params.questions) {
				const reserved = q.options.find(option => RESERVED_OPTION_LABELS[option.label] === true);
				if (reserved) {
					throw new Error(
						`ask: question "${q.id}" uses reserved runtime label "${reserved.label}"; ` +
							`do not include "Other" — the UI adds it automatically`,
					);
				}
			}

			const extensionUi = ctx.ui;
			const ui: UIContext = uiContextFromExtension(extensionUi);

			const timeout =
				typeof params.timeoutSeconds === "number" && params.timeoutSeconds > 0
					? params.timeoutSeconds * 1000
					: null;

			if (ctx.mode === "tui" && process.env.PI_OMK_ASK_NOTIFY !== "0") process.stdout.write("\x07");

			const richQuestions: ExtensionAskDialogQuestion[] = params.questions.map(q => ({
				id: q.id,
				question: q.question,
				...(q.header?.trim() ? { header: q.header } : {}),
				options: q.options.map(option => ({
					label: option.label,
					...(option.description?.trim() ? { description: option.description.trim() } : {}),
					...(option.preview?.trim() ? { preview: option.preview } : {}),
				})),
				...(q.multi !== undefined ? { multi: q.multi } : {}),
				...(q.recommended !== undefined ? { recommended: q.recommended } : {}),
			}));

			if (ctx.mode === "tui") {
				let richResult: ExtensionAskDialogResult | undefined;
				try {
					richResult = await showRichAskDialog(extensionUi, richQuestions, {
						timeoutMilliseconds: timeout ?? undefined,
						signal,
					});
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") {
						ctx.abort();
						throw new Error("Ask input was cancelled");
					}
					throw error;
				}

				if (!richResult) {

					ctx.abort();
					throw new Error("Ask tool was cancelled by the user");
				}
				if (richResult.results.length !== params.questions.length) {
					throw new Error("Ask dialog returned a result count that does not match the requested questions");
				}
				const results: QuestionResult[] = [];
				for (let index = 0; index < params.questions.length; index++) {
					const question = params.questions[index];
					const result = richResult.results[index];
					if (!question || !result || result.id !== question.id) {
						throw new Error("Ask dialog returned results that do not match the requested question order");
					}
					results.push({
						id: question.id,
						question: question.question,
						options: question.options.map(option => option.label),
						multi: question.multi ?? false,
						selectedOptions: result.selectedOptions,
						customInput: result.customInput,
						timedOut: result.timedOut,
					});
				}
				if (params.questions.length === 1) {
					const result = results[0];

					if (
						!result ||
						(!result.timedOut &&
							!result.multi &&
							result.selectedOptions.length === 0 &&
							result.customInput === undefined)
					) {
						ctx.abort();
						throw new Error("Ask tool was cancelled by the user");
					}
					const details: AskToolDetails = {
						question: result.question,
						options: result.options,
						multi: result.multi,
						selectedOptions: result.selectedOptions,
						customInput: result.customInput,
						timedOut: result.timedOut,
					};
					const responseText = formatSingleQuestionResponse(result);
					return { content: [{ type: "text" as const, text: responseText }], details };
				}
				const details: AskToolDetails = { results };
				const responseText = `User answers:\n${results.map(formatQuestionResult).join("\n")}`;
				return { content: [{ type: "text" as const, text: responseText }], details };
			}

			const askQuestion = async (
				q: AskParams["questions"][number],
				options?: { previous?: QuestionResult; navigation?: NavigationControls },
			) => {
				const questionOptions: AskOption[] = q.options.map(option => ({
					label: option.label,
					...(option.description?.trim() ? { description: option.description.trim() } : {}),
				}));
				const optionLabels = questionOptions.map(option => option.label);
				try {
					const { selectedOptions, customInput, navigation, cancelled, timedOut } = await askSingleQuestion(
						ui,
						q.question,
						questionOptions,
						q.multi ?? false,
						{
							recommended: q.recommended,
							timeout: timeout ?? undefined,
							signal,
							initialSelection: options?.previous,
							navigation: options?.navigation,
						},
					);
					return { optionLabels, selectedOptions, customInput, navigation, cancelled, timedOut };
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError") {
						throw new Error("Ask input was cancelled");
					}
					throw error;
				}
			};

			if (params.questions.length === 1) {
				const [q] = params.questions;
				const { optionLabels, selectedOptions, customInput, cancelled, timedOut } = await askQuestion(q);

				if (!timedOut && (cancelled || (selectedOptions.length === 0 && customInput === undefined))) {
					ctx.abort();
					throw new Error("Ask tool was cancelled by the user");
				}
				const details: AskToolDetails = {
					question: q.question,
					options: optionLabels,
					multi: q.multi ?? false,
					selectedOptions,
					customInput,
					timedOut: timedOut || undefined,
				};

				const responseText = formatSingleQuestionResponse({
					selectedOptions,
					customInput,
					timedOut: timedOut || undefined,
					multi: q.multi ?? false,
				});

				return { content: [{ type: "text" as const, text: responseText }], details };
			}

			const resultsByIndex: Array<QuestionResult | undefined> = Array.from({ length: params.questions.length });
			let questionIndex = 0;
			while (questionIndex < params.questions.length) {
				const q = params.questions[questionIndex];
				if (!q) throw new Error("Ask question index exceeded the requested question list");
				const previous = resultsByIndex[questionIndex];
				const navigation: NavigationControls = {
					allowBack: questionIndex > 0,
					allowForward: true,
					progressText: `${questionIndex + 1}/${params.questions.length}`,
				};
				const {
					optionLabels,
					selectedOptions,
					customInput,
					navigation: navAction,
					cancelled,
					timedOut,
				} = await askQuestion(q, { previous, navigation });

				if (cancelled && !timedOut) {
					ctx.abort();
					throw new Error("Ask tool was cancelled by the user");
				}

				resultsByIndex[questionIndex] = {
					id: q.id,
					question: q.question,
					options: optionLabels,
					multi: q.multi ?? false,
					selectedOptions,
					customInput,
					timedOut: timedOut || undefined,
				};

				if (navAction === "back") {
					questionIndex = Math.max(0, questionIndex - 1);
					continue;
				}

				questionIndex += 1;
			}

			const results = params.questions.map((q, index) => {
				const result = resultsByIndex[index];
				if (result) return result;
				return {
					id: q.id,
					question: q.question,
					options: q.options.map(o => o.label),
					multi: q.multi ?? false,
					selectedOptions: [],
				};
			});

			const details: AskToolDetails = { results };
			const responseLines = results.map(formatQuestionResult);
			const responseText = `User answers:\n${responseLines.join("\n")}`;

			return { content: [{ type: "text" as const, text: responseText }], details };
		},

		renderCall: (args, theme) => renderAskCall(args, theme),

		renderResult: (result, _options, theme) => renderAskResult(result, theme),
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) {
			const active = pi.getActiveTools();
			if (active.includes("ask")) {
				pi.setActiveTools(active.filter((name) => name !== "ask"));
			}
		}
	});
}

