import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	generateDiffString,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionToolContext,
	ToolDefinition,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { SDK_TOOL_NAMES } from "./sdk-tools.ts";
import type { SdkToolName } from "./sdk-tools.ts";
import { agentRenderers, executeAgentMirror } from "./render-agent.ts";
import { askRenderers, executeAskMirror } from "./render-ask.ts";
import { toolResultBroker } from "./tool-result-broker.ts";

type ToolArguments = Record<string, unknown>;
type ArgumentMapper = (args: ToolArguments) => ToolArguments;
type BuiltinDefinition = ToolDefinition<any, any, any>;

type MirrorExecutor = (
	toolCallId: string,
	params: ToolArguments,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<any> | undefined,
	ctx: ExtensionToolContext,
) => Promise<AgentToolResult<any>>;

interface MirrorToolSpec {
	label: string;
	description: string;
	parameters: TSchema;
	renderers: ToolRenderers;
	buildDetails?: (args: ToolArguments) => unknown;
	execute?: MirrorExecutor;
}

const RESULT_PREVIEW_LINES = 20;

function looseObject(properties: Record<string, TSchema>) {
	return Type.Object(properties, { additionalProperties: true });
}

function textOf(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asArguments(value: unknown): ToolArguments {
	return typeof value === "object" && value !== null ? (value as ToolArguments) : {};
}

interface BuiltinTitle {
	builtin: string;
	mirrored: string;
}

type RenderTheme = Parameters<NonNullable<ToolRenderers["renderCall"]>>[1];

function retitledTheme(theme: RenderTheme, title: BuiltinTitle): RenderTheme {
	return new Proxy(theme, {
		get(target, property) {
			const value = Reflect.get(target, property);
			if (property === "bold") {
				return (text: string) =>
					target.bold(text.startsWith(title.builtin) ? title.mirrored + text.slice(title.builtin.length) : text);
			}
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function delegateToBuiltin(builtin: BuiltinDefinition, mapArguments: ArgumentMapper, title?: BuiltinTitle): ToolRenderers {
	return {
		renderShell: builtin.renderShell,
		renderCall: (args, theme, context) =>
			builtin.renderCall!(mapArguments(asArguments(args)), title ? retitledTheme(theme, title) : theme, {
				...context,
				args: mapArguments(asArguments(context.args)),
			}),
		renderResult: (result, options, theme, context) =>
			builtin.renderResult!(result, options, theme, {
				...context,
				args: mapArguments(asArguments(context.args)),
			}),
	};
}

function resultText(content: readonly { type: string; text?: string }[]): string {
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
}

function titledRenderers(title: string, summarize: (args: ToolArguments) => string): ToolRenderers {
	return {
		renderCall: (args, theme) => {
			const summary = summarize(asArguments(args));
			return new Text(theme.fg("toolTitle", theme.bold(title)) + (summary ? `  ${theme.fg("muted", summary)}` : ""), 0, 0);
		},
		renderResult: (result, options, theme, context) => {
			const text = resultText(result.content);
			if (options.isPartial) return new Text(theme.fg("muted", `  ${text || "Running..."}`), 0, 0);
			if (context.isError) return new Text(theme.fg("error", `  ${text}`), 0, 0);
			const lines = text.split("\n");
			const shown = lines.slice(0, RESULT_PREVIEW_LINES).map((line) => theme.fg("muted", `  ${line}`));
			if (lines.length > RESULT_PREVIEW_LINES) shown.push(theme.fg("muted", "  ..."));
			return new Text(shown.join("\n"), 0, 0);
		},
	};
}

function mirrorSpecs(cwd: string): Record<SdkToolName, MirrorToolSpec> {
	const mapBash: ArgumentMapper = (args) => ({ command: args.command, timeout: args.timeout });
	const mapRead: ArgumentMapper = (args) => ({ path: args.file_path, offset: args.offset, limit: args.limit });
	const mapGrep: ArgumentMapper = (args) => ({
		pattern: args.pattern,
		path: args.path,
		glob: args.glob,
		ignoreCase: args["-i"],
		context: args["-C"] ?? args.context,
		limit: args.head_limit,
	});
	const mapGlob: ArgumentMapper = (args) => ({ pattern: args.pattern, path: args.path });
	const mapWrite: ArgumentMapper = (args) => ({ path: args.file_path, content: args.content });
	const mapEdit: ArgumentMapper = (args) => ({
		path: args.file_path,
		edits: [{ oldText: args.old_string, newText: args.new_string }],
	});

	return {
		Bash: {
			label: "Bash",
			description: "Shell command executed by the Claude SDK.",
			parameters: looseObject({
				command: Type.String(),
				description: Type.Optional(Type.String()),
				timeout: Type.Optional(Type.Number()),
				run_in_background: Type.Optional(Type.Boolean()),
			}),
			renderers: delegateToBuiltin(createBashToolDefinition(cwd), mapBash),
		},
		Read: {
			label: "Read",
			description: "File read executed by the Claude SDK.",
			parameters: looseObject({
				file_path: Type.String(),
				offset: Type.Optional(Type.Number()),
				limit: Type.Optional(Type.Number()),
				pages: Type.Optional(Type.String()),
			}),
			renderers: delegateToBuiltin(createReadToolDefinition(cwd), mapRead, { builtin: "read", mirrored: "Read" }),
		},
		Grep: {
			label: "Grep",
			description: "Content search executed by the Claude SDK.",
			parameters: looseObject({
				pattern: Type.String(),
				path: Type.Optional(Type.String()),
				glob: Type.Optional(Type.String()),
				output_mode: Type.Optional(Type.String()),
			}),
			renderers: delegateToBuiltin(createGrepToolDefinition(cwd), mapGrep, { builtin: "grep", mirrored: "Grep" }),
		},
		Glob: {
			label: "Glob",
			description: "File pattern search executed by the Claude SDK.",
			parameters: looseObject({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
			renderers: delegateToBuiltin(createFindToolDefinition(cwd), mapGlob, { builtin: "find", mirrored: "Glob" }),
		},
		Write: {
			label: "Write",
			description: "File write executed by the Claude SDK.",
			parameters: looseObject({ file_path: Type.String(), content: Type.String() }),
			renderers: delegateToBuiltin(createWriteToolDefinition(cwd), mapWrite, { builtin: "write", mirrored: "Write" }),
		},
		Edit: {
			label: "Edit",
			description: "File edit executed by the Claude SDK.",
			parameters: looseObject({
				file_path: Type.String(),
				old_string: Type.String(),
				new_string: Type.String(),
				replace_all: Type.Optional(Type.Boolean()),
			}),
			renderers: delegateToBuiltin(createEditToolDefinition(cwd), mapEdit, { builtin: "edit", mirrored: "Edit" }),
			buildDetails: (args) => {
				const oldText = textOf(args.old_string);
				const newText = textOf(args.new_string);
				if (oldText === undefined || newText === undefined) return undefined;
				return generateDiffString(oldText, newText);
			},
		},
		WebSearch: {
			label: "WebSearch",
			description: "Web search executed by the Claude SDK.",
			parameters: looseObject({
				query: Type.String(),
				allowed_domains: Type.Optional(Type.Array(Type.String())),
				blocked_domains: Type.Optional(Type.Array(Type.String())),
			}),
			renderers: titledRenderers("WebSearch", (args) => textOf(args.query) ?? ""),
		},
		WebFetch: {
			label: "WebFetch",
			description: "Web page fetch executed by the Claude SDK.",
			parameters: looseObject({ url: Type.String(), prompt: Type.String() }),
			renderers: titledRenderers("WebFetch", (args) => textOf(args.url) ?? ""),
		},
		TaskStop: {
			label: "TaskStop",
			description: "Background task stop executed by the Claude SDK.",
			parameters: looseObject({ task_id: Type.Optional(Type.String()), shell_id: Type.Optional(Type.String()) }),
			renderers: titledRenderers("TaskStop", (args) => textOf(args.task_id) ?? textOf(args.shell_id) ?? ""),
		},
		Agent: {
			label: "Agent",
			description: "Subagent run executed by the Claude SDK.",
			parameters: looseObject({
				description: Type.String(),
				prompt: Type.String(),
				subagent_type: Type.Optional(Type.String()),
				model: Type.Optional(Type.String()),
				run_in_background: Type.Optional(Type.Boolean()),
			}),
			renderers: agentRenderers(),
			execute: (toolCallId, _params, signal, onUpdate) => executeAgentMirror(toolCallId, signal, onUpdate),
		},
		Skill: {
			label: "Skill",
			description: "Skill invocation executed by the Claude SDK.",
			parameters: looseObject({ skill: Type.String(), args: Type.Optional(Type.String()) }),
			renderers: titledRenderers("Skill", (args) => textOf(args.skill) ?? ""),
		},
		AskUserQuestion: {
			label: "AskUserQuestion",
			description: "Clarifying question answered through pi's ask dialog and relayed to the Claude SDK.",
			parameters: looseObject({
				questions: Type.Array(
					looseObject({
						question: Type.String(),
						header: Type.Optional(Type.String()),
						options: Type.Array(
							looseObject({
								label: Type.String(),
								description: Type.Optional(Type.String()),
								preview: Type.Optional(Type.String()),
							}),
						),
						multiSelect: Type.Optional(Type.Boolean()),
					}),
				),
			}),
			renderers: askRenderers(),
			execute: (toolCallId, params, signal, _onUpdate, ctx) => executeAskMirror(toolCallId, params, signal, ctx),
		},
	};
}

export const MIRROR_TOOL_NAMES: readonly string[] = SDK_TOOL_NAMES;

export function registerMirrorTools(pi: ExtensionAPI): void {
	const specs = mirrorSpecs(process.cwd());
	for (const toolName of SDK_TOOL_NAMES) {
		const spec = specs[toolName];
		pi.registerTool({
			name: toolName,
			label: spec.label,
			description: spec.description,
			parameters: spec.parameters,
			defaultActive: false,
			renderShell: spec.renderers.renderShell,
			renderCall: spec.renderers.renderCall,
			renderResult: spec.renderers.renderResult,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				if (spec.execute) return spec.execute(toolCallId, params as ToolArguments, signal, onUpdate, ctx);
				const result = await toolResultBroker.wait(toolCallId, signal);
				return {
					content: result.content,
					details: result.isError ? undefined : spec.buildDetails?.(params as ToolArguments),
					...(result.isError ? { isError: true } : {}),
				};
			},
		});
	}
}
