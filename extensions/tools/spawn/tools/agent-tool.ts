import type { AgentToolResult, ExtensionContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AgentTypeRegistry } from "../config/agent-types.ts";
import type { ParentSnapshot } from "../lifecycle/parent-snapshot.ts";
import type {
	AgentSpawnConfig,
	ResumeCallOptions,
	ResumeRefusalReason,
	ResumeStart,
} from "../lifecycle/spawn-manager.ts";
import {
	renderOutcomeAddenda,
	renderOutcomeBody,
	renderStatusNote,
} from "../observation/outcome-delivery.ts";
import { runForeground, startRunningStream } from "./foreground-runner.ts";
import { buildAgentGuidelines, buildDetails, buildTypeListText, textResult } from "./helpers.ts";
import { renderAgentResult } from "./result-renderer.ts";
import {
	type ModelInfo,
	resolveSpawnConfig,
	type SpawnPresentation,
} from "./spawn-config.ts";
import type { ParentSessionInfo, Spawn } from "../types.ts";
import { type AgentDetails, getDisplayName, type Theme } from "../ui/display.ts";

export interface AgentToolManager {
	spawnAndWait: (snapshot: ParentSnapshot, type: string, prompt: string, opts: AgentSpawnConfig) => Promise<Spawn>;
	startResume: (id: string, prompt: string, options: ResumeCallOptions) => ResumeStart;
	getRecord: (id: string) => Spawn | undefined;
}

export interface AgentToolRuntime {
	buildSnapshot(inheritContext: boolean): ParentSnapshot;
	getModelInfo(): ModelInfo;
	getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

export type AgentToolSettings = {
	readonly defaultMaxTurns: number | undefined;
};

export class AgentTool {
	private readonly typeListText: string;
	private readonly availableTypesText: string;
	private readonly agentGuidelines: string[];

	constructor(
		private readonly manager: AgentToolManager,
		private readonly runtime: AgentToolRuntime,
		private readonly settings: AgentToolSettings,
		private readonly registry: AgentTypeRegistry,
	) {
		this.typeListText = buildTypeListText(registry);
		this.availableTypesText = registry.getAvailableTypes().join(", ");
		this.agentGuidelines = buildAgentGuidelines(registry);
	}

	async execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
		_ctx: ExtensionContext,
	) {

		this.registry.reload();

		const config = resolveSpawnConfig(
			params,
			this.registry,
			this.runtime.getModelInfo(),
			this.settings,
		);
		if ("error" in config) return textResult(config.error);

		const snapshot = this.runtime.buildSnapshot(config.execution.inheritContext);
		const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
		const parentSession: ParentSessionInfo = { parentSessionFile, parentSessionId, toolCallId };

		if (params.resume) {
			const id = params.resume as string;
			const prompt = params.prompt as string;
			return this.resumeExisting(id, prompt, signal, config.presentation.detailBase, onUpdate);
		}

		return runForeground(
			this.manager,
			{ config, snapshot, parentSession },
			signal,
			onUpdate,
		);
	}

	private async resumeExisting(
		id: string,
		prompt: string,
		signal: AbortSignal | undefined,
		detailBase: SpawnPresentation["detailBase"],
		onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
	) {

		const start = this.manager.startResume(id, prompt, {
			signal: signal ?? new AbortController().signal,
			claimOutcome: true,
		});
		if (start.kind === "refused") {
			return textResult(resumeRefusalMessage(start.reason, id));
		}
		const record = start.record;
		const stopStream = startRunningStream(
			() => record,
			detailBase,
			onUpdate,
			record.startedAt,
		);
		try {
			await record.promise;
		} finally {
			stopStream();
		}

		record.markConsumed();
		return textResult(
			`Agent ID: ${record.id}${renderStatusNote(record)}\n\n` +
				renderOutcomeBody(record) +
				renderOutcomeAddenda(record),
			buildDetails(detailBase, record),
		);
	}

	toToolDefinition() {
		const typeListText = this.typeListText;
		const availableTypesText = this.availableTypesText;
		const registry = this.registry;

		const guidelines = [
			"- For independent work, launch several agents in one turn — each call blocks until its agent finishes and the result arrives inline.",
			...this.agentGuidelines,
			"- Provide clear, detailed prompts so the agent can work autonomously.",
			"- Spawn results are returned as text — summarize them for the user.",
			"- Use resume with an agent ID to continue a previous agent's work, or to answer an agent that ended its turn with a question.",
			'- Use model to specify a different model (as "provider/modelId", fuzzy e.g. "haiku", "sonnet", "default" for Pi\'s configured default, or "inherit" for the parent session model).',
			"- Use thinking to control extended thinking level.",
			"- Use inherit_context if the agent needs the parent conversation history.",
		].join("\n");

		return defineTool({
			name: "spawn" as const,
			label: "Spawn",
			promptSnippet: "Launch a specialized agent for complex, multi-step tasks.",
			description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The spawn tool launches specialized agents that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:
${typeListText}

Guidelines:
${guidelines}
`,
			parameters: Type.Object({
				prompt: Type.String({
					description: "The task for the agent to perform.",
				}),
				description: Type.String({
					description: "A short (3-5 word) description of the task (shown in UI).",
				}),
				spawn_type: Type.String({
					description: `The type of specialized agent to use. Available types: ${availableTypesText}. Agents defined in ~/.pi/agents/<name>.md (global) or .pi/agents/<name>.md (project) are also available; ~/.agents/agents/ and .agents/agents/ are read as additional sources.`,
				}),
				model: Type.Optional(
					Type.String({
						description:
							'Optional model override. Accepts "provider/modelId" or fuzzy name (e.g. "haiku", "sonnet"), "default" for Pi\'s configured default model, or "inherit" for the parent session model. Omit to use the agent type\'s default.',
					}),
				),
				thinking: Type.Optional(
					Type.String({
						description:
							"Thinking level: off, minimal, low, medium, high, xhigh, max. Overrides the agent's default.",
					}),
				),
				max_turns: Type.Optional(
					Type.Number({
						description:
							"Maximum number of agentic turns before stopping. Omit to use the agent's own limit, or unlimited when it declares none.",
						minimum: 1,
					}),
				),
				resume: Type.Optional(
					Type.String({
						description:
							"Optional agent ID to resume from. Continues from previous context. Resolves when the resumed run reaches a terminal state.",
					}),
				),
				inherit_context: Type.Optional(
					Type.Boolean({
						description:
							"If true, fork parent conversation into the agent. Omit to use the agent's own default, which is fresh context unless it declares otherwise.",
					}),
				),
			}),

			renderCall(args: Record<string, unknown>, theme: Theme) {
				const displayName = args.spawn_type
					? getDisplayName(args.spawn_type as string, registry)
					: "Spawn";
				const desc = (args.description as string | undefined) ?? "";
				return new Text(
					theme.fg("toolTitle", theme.bold(displayName)) +
						(desc ? "  " + theme.fg("muted", desc) : ""),
					0,
					0,
				);
			},

			renderResult(
				result: AgentToolResult<AgentDetails | undefined>,
				{ expanded, isPartial }: ToolRenderResultOptions,
				theme: Theme,
			) {
				const details = result.details;
				if (!details) {
					const text = result.content[0]?.type === "text" ? result.content[0].text : "";
					return new Text(text, 0, 0);
				}
				const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(
					renderAgentResult(details, resultText, expanded, isPartial, theme),
					0,
					0,
				);
			},

			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
				onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
				ctx: ExtensionContext,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}

function resumeRefusalMessage(refusal: ResumeRefusalReason, id: string): string {
	switch (refusal) {
		case "unknown-agent":
			return `Agent not found: "${id}". Records are cleared at session start/switch, so it may be from a previous session.`;
		case "still-running":
			return `Agent "${id}" is still running; wait for it to finish before resuming.`;
		case "session-released":
			return (
				`Agent "${id}" had its session released after its retention window; resume is unavailable. ` +
				"Its result was already returned; spawn a new agent to continue the work."
			);
		case "no-session":
			return `Agent "${id}" has no active session to resume.`;
		case "workspace-disposed":
			return (
				`Agent "${id}" ran in an isolated workspace that no longer ` +
				"exists; resume is unavailable because the agent would re-enter a directory that " +
				"has been removed. Spawn a new agent instead — the agent's result records where " +
				"any work was saved."
			);
	}
}
