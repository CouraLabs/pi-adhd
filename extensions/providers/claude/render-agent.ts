import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentToolResult, AgentToolUpdateCallback, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { toolResultBroker } from "./tool-result-broker.ts";

export type AgentRunStatus = "running" | "completed" | "failed" | "stopped";

export interface AgentRunSnapshot {
	subagentType?: string;
	description?: string;
	status: AgentRunStatus;
	toolCallCount: number;
	lastToolName?: string;
	summary?: string;
	totalTokens?: number;
	durationMs?: number;
}

type AgentRunListener = (snapshot: AgentRunSnapshot) => void;

interface TrackedRun {
	sessionKey: string;
	snapshot: AgentRunSnapshot;
	seenToolUseIds: Set<string>;
	listeners: Set<AgentRunListener>;
}

const RESULT_COLLAPSED_LINES = 5;
const UNASSIGNED_SESSION_KEY = "";

function parentToolUseIdOf(message: SDKMessage): string | undefined {
	const parentId = (message as { parent_tool_use_id?: string | null }).parent_tool_use_id;
	return typeof parentId === "string" ? parentId : undefined;
}

export class AgentProgressRouter {
	private readonly runs = new Map<string, TrackedRun>();
	private readonly releasedToolUseIds = new Set<string>();

	route(sessionKey: string, message: SDKMessage): void {
		if (message.type === "system") {
			this.routeSystemMessage(sessionKey, message);
			return;
		}
		const parentToolUseId = parentToolUseIdOf(message);
		if (parentToolUseId === undefined) return;
		if (message.type === "assistant") this.routeSubagentAssistantMessage(sessionKey, parentToolUseId, message);
	}

	subscribe(toolUseId: string, listener: AgentRunListener): () => void {
		const run = this.trackedRun(toolUseId, UNASSIGNED_SESSION_KEY);
		if (!run) return () => undefined;
		run.listeners.add(listener);
		listener(run.snapshot);
		return () => run.listeners.delete(listener);
	}

	snapshotOf(toolUseId: string): AgentRunSnapshot | undefined {
		return this.runs.get(toolUseId)?.snapshot;
	}

	release(toolUseId: string): void {
		this.runs.delete(toolUseId);
		this.releasedToolUseIds.add(toolUseId);
	}

	disposeSession(sessionKey: string): void {
		for (const [toolUseId, run] of [...this.runs]) {
			if (run.sessionKey === sessionKey) this.runs.delete(toolUseId);
		}
	}

	private trackedRun(toolUseId: string, sessionKey: string): TrackedRun | undefined {
		if (this.releasedToolUseIds.has(toolUseId)) return undefined;
		let run = this.runs.get(toolUseId);
		if (!run) {
			run = { sessionKey, snapshot: { status: "running", toolCallCount: 0 }, seenToolUseIds: new Set(), listeners: new Set() };
			this.runs.set(toolUseId, run);
		}
		if (run.sessionKey === UNASSIGNED_SESSION_KEY) run.sessionKey = sessionKey;
		return run;
	}

	private update(toolUseId: string, sessionKey: string, change: (run: TrackedRun) => void): void {
		const run = this.trackedRun(toolUseId, sessionKey);
		if (!run) return;
		change(run);
		run.snapshot = { ...run.snapshot };
		for (const listener of run.listeners) listener(run.snapshot);
	}

	private routeSystemMessage(sessionKey: string, message: Extract<SDKMessage, { type: "system" }>): void {
		switch (message.subtype) {
			case "task_started": {
				if (!message.tool_use_id) return;
				this.update(message.tool_use_id, sessionKey, (run) => {
					run.snapshot.subagentType = message.subagent_type ?? run.snapshot.subagentType;
					run.snapshot.description = message.description;
				});
				return;
			}
			case "task_progress": {
				if (!message.tool_use_id) return;
				this.update(message.tool_use_id, sessionKey, (run) => {
					run.snapshot.subagentType = message.subagent_type ?? run.snapshot.subagentType;
					run.snapshot.description = message.description;
					run.snapshot.toolCallCount = Math.max(run.snapshot.toolCallCount, message.usage.tool_uses);
					run.snapshot.lastToolName = message.last_tool_name ?? run.snapshot.lastToolName;
					run.snapshot.summary = message.summary ?? run.snapshot.summary;
					run.snapshot.totalTokens = message.usage.total_tokens;
					run.snapshot.durationMs = message.usage.duration_ms;
				});
				return;
			}
			case "task_notification": {
				if (!message.tool_use_id) return;
				this.update(message.tool_use_id, sessionKey, (run) => {
					run.snapshot.status = message.status;
					if (message.usage) {
						run.snapshot.toolCallCount = Math.max(run.snapshot.toolCallCount, message.usage.tool_uses);
						run.snapshot.totalTokens = message.usage.total_tokens;
						run.snapshot.durationMs = message.usage.duration_ms;
					}
				});
				return;
			}
			default:
				return;
		}
	}

	private routeSubagentAssistantMessage(
		sessionKey: string,
		parentToolUseId: string,
		message: Extract<SDKMessage, { type: "assistant" }>,
	): void {
		const content = message.message.content;
		if (!Array.isArray(content)) return;
		const toolUses = content.filter((block) => block.type === "tool_use");
		if (toolUses.length === 0) return;
		this.update(parentToolUseId, sessionKey, (run) => {
			for (const toolUse of toolUses) run.seenToolUseIds.add(toolUse.id);
			run.snapshot.toolCallCount = Math.max(run.snapshot.toolCallCount, run.seenToolUseIds.size);
			run.snapshot.lastToolName = toolUses[toolUses.length - 1].name;
		});
	}
}

export const agentProgressRouter = new AgentProgressRouter();

function pluralizedToolCalls(count: number): string {
	return `${count} tool ${count === 1 ? "call" : "calls"}`;
}

function formatDuration(durationMs: number): string {
	const seconds = Math.round(durationMs / 1000);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function describeAgentProgress(snapshot: AgentRunSnapshot): string {
	const statusText = snapshot.summary ?? snapshot.description ?? "Working";
	const parts = [statusText, pluralizedToolCalls(snapshot.toolCallCount)];
	if (snapshot.lastToolName && snapshot.status === "running") parts.push(`last: ${snapshot.lastToolName}`);
	if (snapshot.durationMs !== undefined) parts.push(formatDuration(snapshot.durationMs));
	return parts.join(" · ");
}

function snapshotFromDetails(details: unknown): AgentRunSnapshot | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const snapshot = (details as { agentRun?: AgentRunSnapshot }).agentRun;
	return snapshot;
}

function textOf(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

const AGENT_ICON = "⯁";
const STATS_SEPARATOR = " ⋅ ";

function pascalCase(name: string): string {
	return name
		.split(/[-_\s]+/)
		.filter((part) => part.length > 0)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join("");
}

function formatStats(snapshot: AgentRunSnapshot): string {
	const parts: string[] = [];
	if (snapshot.totalTokens !== undefined) parts.push(`${snapshot.totalTokens} Tks`);
	parts.push(`${snapshot.toolCallCount} ${snapshot.toolCallCount === 1 ? "tool" : "tools"}`);
	if (snapshot.durationMs !== undefined) parts.push(formatDuration(snapshot.durationMs));
	return parts.join(STATS_SEPARATOR);
}

export function cleanAgentReport(text: string): string {
	const lines = text.split("\n");
	const frameEnd = lines.findIndex((line) => line.trimEnd().endsWith("The report follows:"));
	const body = frameEnd >= 0 ? lines.slice(frameEnd + 1) : lines;
	const usageStart = body.findIndex((line) => line.trimStart().startsWith("<usage>"));
	const withoutUsage = usageStart >= 0 ? body.slice(0, usageStart) : body;
	const withoutId = withoutUsage.filter((line) => !line.trimStart().startsWith("agentId:"));
	return withoutId
		.map((line) => line.replace(/^ {4}/, ""))
		.join("\n")
		.trim();
}

export function agentRenderers(): ToolRenderers {
	return {
		renderCall: (args, theme, context) => {
			const input = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
			const kind = pascalCase(textOf(input.subagent_type) ?? "general-purpose");
			const description = textOf(input.description);
			const snapshot = (context.state as { agentRun?: AgentRunSnapshot } | undefined)?.agentRun;
			const failed = context.isError || snapshot?.status === "failed";
			const iconColor = failed ? "error" : snapshot ? "success" : context.executionStarted ? "warning" : "muted";
			const icon = theme.fg(iconColor, AGENT_ICON);
			const header = `${icon} ${theme.fg("toolTitle", theme.bold("Agent"))} ${theme.fg("accent", kind)}`;
			const title = description ? `${header}${theme.fg("muted", `: ${description}`)}` : header;
			return new Text(snapshot ? `${title}${theme.fg("muted", ` - ${formatStats(snapshot)}`)}` : title, 0, 0);
		},
		renderResult: (result, options, theme, context) => {
			const snapshot = snapshotFromDetails(result.details);
			if (options.isPartial) {
				const progress = snapshot ? describeAgentProgress(snapshot) : "Starting";
				return new Text(theme.fg("muted", `  ⋯ ${progress}`), 0, 0);
			}
			const lines: string[] = [];
			const state = context.state as { agentRun?: AgentRunSnapshot } | undefined;
			if (snapshot && state && !state.agentRun) {
				state.agentRun = snapshot;
				context.invalidate();
			}
			const text = cleanAgentReport(
				result.content
					.filter((block) => block.type === "text")
					.map((block) => block.text)
					.join("\n"),
			);
			const resultLines = text.length > 0 ? text.split("\n") : [];
			const shown = options.expanded ? resultLines : resultLines.slice(0, RESULT_COLLAPSED_LINES);
			const color = context.isError ? "error" : "toolOutput";
			for (const line of shown) lines.push(theme.fg(color, `  ${line}`));
			const hidden = resultLines.length - shown.length;
			if (hidden > 0) lines.push(theme.fg("dim", `  … ${hidden} more ${hidden === 1 ? "line" : "lines"} (expand to view)`));
			return new Text(lines.join("\n"), 0, 0);
		},
	};
}

export async function executeAgentMirror(
	toolCallId: string,
	signal: AbortSignal | undefined,
	onUpdate: AgentToolUpdateCallback<{ agentRun: AgentRunSnapshot }> | undefined,
): Promise<AgentToolResult<{ agentRun: AgentRunSnapshot }>> {
	const unsubscribe = agentProgressRouter.subscribe(toolCallId, (snapshot) => {
		onUpdate?.({
			content: [{ type: "text", text: describeAgentProgress(snapshot) }],
			details: { agentRun: snapshot },
		});
	});
	try {
		const result = await toolResultBroker.wait(toolCallId, signal);
		const finalSnapshot = agentProgressRouter.snapshotOf(toolCallId) ?? { status: "completed" as const, toolCallCount: 0 };
		const agentRun: AgentRunSnapshot = {
			...finalSnapshot,
			status: result.isError ? "failed" : finalSnapshot.status === "running" ? "completed" : finalSnapshot.status,
		};
		return { content: result.content, details: { agentRun }, ...(result.isError ? { isError: true } : {}) };
	} finally {
		unsubscribe();
		agentProgressRouter.release(toolCallId);
	}
}
