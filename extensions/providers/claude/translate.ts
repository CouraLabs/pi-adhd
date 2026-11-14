import type {
	AssistantMessage,
	AssistantMessageEventStream,
	ImageContent,
	Message,
	Model,
	Api,
	TextContent,
	ToolCall,
	Usage,
} from "@earendil-works/pi-ai";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnDiagnostics, isFailedResult } from "./errors.ts";
import { piToolNameFromMcpName } from "./pi-mcp.ts";
import { recordRateLimit } from "./rate-limit-windows.ts";
import { isMirroredSdkTool } from "./sdk-tools.ts";
import { UsageTracker } from "./usage.ts";

export const CLAUDE_API_ID = "claude-agent-sdk";

export type TurnOutcome = "stop" | "length" | "toolUse" | "error" | "aborted";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

type AssistantSdkMessage = Extract<SDKMessage, { type: "assistant" }>;

export interface TurnTranslatorHooks {
	readonly onToolCall: (toolUseId: string) => void;
	readonly markStreamed: (messageId: string) => void;
	readonly wasStreamed: (messageId: string) => boolean;
	readonly turnCostOf: (result: ResultMessage) => number;
}

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createAssistantShell(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function extractUserContent(message: Message): (TextContent | ImageContent)[] {
	if (message.role !== "user") return [];
	if (typeof message.content === "string") return [{ type: "text", text: message.content }];
	return message.content;
}

export function buildUserMessage(messages: Message[], sessionId: string, preamble?: string): SDKUserMessage {
	const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
	if (!lastUserMessage) throw new Error("claude provider: transcript has no user message to send");

	const content = extractUserContent(lastUserMessage).map((block) =>
		block.type === "text"
			? { type: "text" as const, text: block.text }
			: {
					type: "image" as const,
					source: { type: "base64" as const, media_type: block.mimeType as "image/png", data: block.data },
				},
	);
	if (content.length === 0) throw new Error("claude provider: last user message is empty");

	return {
		type: "user",
		message: {
			role: "user",
			content: preamble ? [{ type: "text" as const, text: preamble }, ...content] : content,
		},
		parent_tool_use_id: null,
		session_id: sessionId,
		uuid: randomUUID(),
	};
}

const SYNTHETIC_MODEL = "<synthetic>";

const LOCAL_COMMAND_TAGS = /<\/?local-command-std(?:out|err)>/g;

function textOfBlocks(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function toolArguments(input: unknown): ToolCall["arguments"] {
	return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as ToolCall["arguments"]) : {};
}

function piToolNameOf(sdkToolName: string): string | undefined {
	const piOwned = piToolNameFromMcpName(sdkToolName);
	if (piOwned !== undefined) return piOwned;
	return isMirroredSdkTool(sdkToolName) ? sdkToolName : undefined;
}

type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

type BlockDelta = Extract<StreamEvent, { type: "content_block_delta" }>["delta"];

interface BlockRef {
	contentIndex: number;
	kind: "text" | "thinking" | "toolCall";
	partialJson: string;
}

export class TurnTranslator {
	private readonly blocksBySdkIndex = new Map<number, BlockRef>();
	private readonly usage = new UsageTracker();
	private readonly diagnostics = new TurnDiagnostics();
	private outcome: TurnOutcome | undefined;
	private toolCallsInMessage = 0;
	private currentMessageId = "";
	private localOutputRendered = false;

	constructor(
		private readonly output: AssistantMessage,
		private readonly stream: AssistantMessageEventStream,
		private readonly hooks: TurnTranslatorHooks,
	) {}

	get finished(): boolean {
		return this.outcome !== undefined;
	}

	get pausedForToolResults(): boolean {
		return this.outcome === "toolUse";
	}

	get completedNormally(): boolean {
		return this.outcome === "stop" || this.outcome === "length";
	}

	handle(sdkMessage: SDKMessage): void {
		this.diagnostics.observe(sdkMessage);
		switch (sdkMessage.type) {
			case "stream_event":
				if (sdkMessage.parent_tool_use_id === null) this.handleStreamEvent(sdkMessage.event);
				return;
			case "assistant":
				if (sdkMessage.parent_tool_use_id === null) this.handleAssistant(sdkMessage);
				return;
			case "system":
				if (sdkMessage.subtype === "local_command_output") this.renderLocalOutput(sdkMessage.content);
				return;
			case "result":
				this.handleResult(sdkMessage);
				return;
			case "rate_limit_event":
				recordRateLimit(sdkMessage.rate_limit_info);
				return;
			default:
				return;
		}
	}

	finish(outcome: Extract<TurnOutcome, "error" | "aborted">, message?: string): void {
		this.closeOpenBlocks();
		this.applyUsage();
		this.outcome = outcome;
		this.output.stopReason = outcome;
		this.output.errorMessage = message;
		this.stream.push({ type: "error", reason: outcome, error: this.output });
		this.stream.end();
	}

	private handleStreamEvent(event: StreamEvent): void {
		switch (event.type) {
			case "message_start":
				this.closeOpenBlocks();
				this.toolCallsInMessage = 0;
				this.currentMessageId = event.message.id;
				this.hooks.markStreamed(event.message.id);
				this.recordUsage(event.message.id, event.message.usage);
				return;
			case "message_delta":
				this.recordUsage(this.currentMessageId, event.usage);
				return;
			case "message_stop":
				this.closeOpenBlocks();
				if (this.toolCallsInMessage > 0) this.finishForToolUse();
				return;
			case "content_block_start":
				if (event.content_block.type === "tool_use") {
					this.startToolCall(event.index, event.content_block.id, event.content_block.name);
				} else {
					this.startBlock(event.index, event.content_block.type);
				}
				return;
			case "content_block_delta":
				this.appendDelta(event.index, event.delta);
				return;
			case "content_block_stop":
				this.closeBlock(event.index);
				return;
			default:
				return;
		}
	}

	private handleAssistant(message: AssistantSdkMessage): void {
		if (message.error) return;
		if (message.message.model === SYNTHETIC_MODEL) {
			if (this.output.content.length === 0) this.renderLocalOutput(textOfBlocks(message.message.content));
			return;
		}
		this.recordUsage(message.message.id, message.message.usage);
		if (this.hooks.wasStreamed(message.message.id)) {
			this.reconcileToolArguments(message);
			return;
		}
		this.renderCompleteMessage(message);
	}

	private reconcileToolArguments(message: AssistantSdkMessage): void {
		for (const block of message.message.content) {
			if (block.type !== "tool_use") continue;
			const target = this.output.content.find((content): content is ToolCall => content.type === "toolCall" && content.id === block.id);
			if (target) target.arguments = toolArguments(block.input);
		}
	}

	private renderCompleteMessage(message: AssistantSdkMessage): void {
		this.closeOpenBlocks();
		let toolCalls = 0;
		for (const block of message.message.content) {
			if (block.type === "text" && block.text) this.pushCompleteText(block.text);
			else if (block.type === "thinking" && block.thinking) this.pushCompleteThinking(block.thinking);
			else if (block.type === "tool_use" && this.pushCompleteToolCall(block.id, block.name, block.input)) toolCalls += 1;
		}
		if (toolCalls > 0) this.finishForToolUse();
	}

	private pushCompleteText(text: string): void {
		const contentIndex = this.output.content.length;
		this.output.content.push({ type: "text", text });
		this.stream.push({ type: "text_start", contentIndex, partial: this.output });
		this.stream.push({ type: "text_delta", contentIndex, delta: text, partial: this.output });
		this.stream.push({ type: "text_end", contentIndex, content: text, partial: this.output });
	}

	private pushCompleteThinking(thinking: string): void {
		const contentIndex = this.output.content.length;
		this.output.content.push({ type: "thinking", thinking });
		this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
		this.stream.push({ type: "thinking_delta", contentIndex, delta: thinking, partial: this.output });
		this.stream.push({ type: "thinking_end", contentIndex, content: thinking, partial: this.output });
	}

	private pushCompleteToolCall(toolUseId: string, sdkToolName: string, input: unknown): boolean {
		const name = piToolNameOf(sdkToolName);
		if (name === undefined) return false;
		const contentIndex = this.output.content.length;
		const toolCall: ToolCall = { type: "toolCall", id: toolUseId, name, arguments: toolArguments(input) };
		this.output.content.push(toolCall);
		this.hooks.onToolCall(toolUseId);
		this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
		this.stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: this.output });
		return true;
	}

	private renderLocalOutput(rawText: string): void {
		const text = rawText.replace(LOCAL_COMMAND_TAGS, "").trim();
		if (this.localOutputRendered || text.length === 0) return;
		this.localOutputRendered = true;
		this.closeOpenBlocks();
		this.pushCompleteText(text);
	}

	private finishForToolUse(): void {
		if (this.finished) return;
		this.applyUsage();
		this.outcome = "toolUse";
		this.output.stopReason = "toolUse";
		this.stream.push({ type: "done", reason: "toolUse", message: this.output });
		this.stream.end();
	}

	private startToolCall(sdkIndex: number, toolUseId: string, toolName: string): void {
		const name = piToolNameOf(toolName);
		if (name === undefined) return;
		const contentIndex = this.output.content.length;
		this.blocksBySdkIndex.set(sdkIndex, { contentIndex, kind: "toolCall", partialJson: "" });
		this.output.content.push({ type: "toolCall", id: toolUseId, name, arguments: {} });
		this.hooks.onToolCall(toolUseId);
		this.toolCallsInMessage += 1;
		this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
	}

	private startBlock(sdkIndex: number, blockType: string): void {
		if (blockType !== "text" && blockType !== "thinking") return;
		const contentIndex = this.output.content.length;
		this.blocksBySdkIndex.set(sdkIndex, { contentIndex, kind: blockType, partialJson: "" });
		if (blockType === "text") {
			this.output.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex, partial: this.output });
		} else {
			this.output.content.push({ type: "thinking", thinking: "" });
			this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
		}
	}

	private appendDelta(sdkIndex: number, delta: BlockDelta): void {
		const block = this.blocksBySdkIndex.get(sdkIndex);
		if (!block) return;
		const target = this.output.content[block.contentIndex];
		if (block.kind === "toolCall" && target.type === "toolCall") {
			if (delta.type === "input_json_delta" && delta.partial_json) {
				block.partialJson += delta.partial_json;
				target.arguments = parseStreamingJson(block.partialJson);
				this.stream.push({
					type: "toolcall_delta",
					contentIndex: block.contentIndex,
					delta: delta.partial_json,
					partial: this.output,
				});
			}
			return;
		}
		if (block.kind === "text" && target.type === "text" && delta.type === "text_delta" && delta.text) {
			target.text += delta.text;
			this.stream.push({ type: "text_delta", contentIndex: block.contentIndex, delta: delta.text, partial: this.output });
		} else if (block.kind === "thinking" && target.type === "thinking") {
			if (delta.type === "thinking_delta" && delta.thinking) {
				target.thinking += delta.thinking;
				this.stream.push({
					type: "thinking_delta",
					contentIndex: block.contentIndex,
					delta: delta.thinking,
					partial: this.output,
				});
			}
		}
	}

	private closeBlock(sdkIndex: number): void {
		const block = this.blocksBySdkIndex.get(sdkIndex);
		if (!block) return;
		this.blocksBySdkIndex.delete(sdkIndex);
		const target = this.output.content[block.contentIndex];
		if (block.kind === "toolCall" && target.type === "toolCall") {
			target.arguments = parseStreamingJson(block.partialJson);
			this.stream.push({ type: "toolcall_end", contentIndex: block.contentIndex, toolCall: target, partial: this.output });
		} else if (block.kind === "text" && target.type === "text") {
			this.stream.push({ type: "text_end", contentIndex: block.contentIndex, content: target.text, partial: this.output });
		} else if (block.kind === "thinking" && target.type === "thinking") {
			this.stream.push({
				type: "thinking_end",
				contentIndex: block.contentIndex,
				content: target.thinking,
				partial: this.output,
			});
		}
	}

	private closeOpenBlocks(): void {
		for (const sdkIndex of [...this.blocksBySdkIndex.keys()]) this.closeBlock(sdkIndex);
	}

	private recordUsage(callId: string, usage: Parameters<UsageTracker["record"]>[1]): void {
		this.usage.record(callId, usage);
		this.applyUsage();
	}

	private applyUsage(): void {
		this.usage.applyTo(this.output.usage);
	}

	private handleResult(result: ResultMessage): void {
		this.closeOpenBlocks();
		if (result.num_turns === 1) this.usage.recordTurnTotal(result.usage);
		this.applyUsage();
		this.output.usage.cost.total = this.hooks.turnCostOf(result);
		if (isFailedResult(result)) {
			this.finish("error", this.diagnostics.describeFailure(result));
			return;
		}
		const reason = result.stop_reason === "max_tokens" ? "length" : "stop";
		this.outcome = reason;
		this.output.stopReason = reason;
		this.stream.push({ type: "done", reason, message: this.output });
		this.stream.end();
	}
}
