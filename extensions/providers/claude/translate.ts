import type {
	AssistantMessage,
	AssistantMessageEventStream,
	ImageContent,
	Message,
	Model,
	Api,
	TextContent,
	Usage,
} from "@earendil-works/pi-ai";
import { parseStreamingJson } from "@earendil-works/pi-ai";
import type { SDKAssistantMessageError, SDKMessage, SDKRateLimitInfo, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { resetTimestampToMilliseconds, setRateLimitWindow, utilizationToPercent, type RateLimitWindowId } from "../../../shared/rate-limits.ts";
import { piToolNameFromMcpName } from "./pi-mcp.ts";
import { isMirroredSdkTool } from "./sdk-tools.ts";

export const CLAUDE_API_ID = "claude-agent-sdk";

const AUTH_ERROR_GUIDANCE =
	"Claude is not signed in. Run `claude /login` in a terminal or set ANTHROPIC_API_KEY. pi never handles Claude credentials.";

type UnifiedRateLimitWindow = { utilization: number; resetsAt: number };

type RuntimeRateLimitInfo = SDKRateLimitInfo & {
	unifiedWindows?: Partial<Record<string, UnifiedRateLimitWindow>>;
};

const RATE_LIMIT_WINDOWS: Readonly<Record<string, RateLimitWindowId>> = {
	five_hour: "fiveHour",
	seven_day: "sevenDay",
};

function recordRateLimitWindow(windowId: RateLimitWindowId, utilization: number | undefined, resetsAt: number | undefined): void {
	if (utilization === undefined || resetsAt === undefined) return;
	setRateLimitWindow(windowId, {
		percent: utilizationToPercent(utilization),
		resetsAt: resetTimestampToMilliseconds(resetsAt),
	});
}

function recordRateLimit(info: RuntimeRateLimitInfo): void {
	for (const [windowType, windowId] of Object.entries(RATE_LIMIT_WINDOWS)) {
		const unified = info.unifiedWindows?.[windowType];
		if (unified) recordRateLimitWindow(windowId, unified.utilization, unified.resetsAt);
	}
	const limitingWindowId = info.rateLimitType ? RATE_LIMIT_WINDOWS[info.rateLimitType] : undefined;
	if (limitingWindowId && !info.unifiedWindows?.[info.rateLimitType as string]) {
		recordRateLimitWindow(limitingWindowId, info.utilization, info.resetsAt);
	}
}

const SDK_ERROR_MESSAGES: Partial<Record<SDKAssistantMessageError, string>> = {
	authentication_failed: AUTH_ERROR_GUIDANCE,
	oauth_org_not_allowed: AUTH_ERROR_GUIDANCE,
	account_on_hold: "The Claude account is on hold.",
	billing_error: "Claude reported a billing error for this account.",
	rate_limit: "Claude rate limit reached.",
	overloaded: "Claude is overloaded. Try again shortly.",
	model_not_found: "Claude does not recognise this model for the signed-in account.",
};

export type TurnOutcome = "stop" | "length" | "toolUse" | "error" | "aborted";

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

type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

type BlockDelta = Extract<StreamEvent, { type: "content_block_delta" }>["delta"];

interface BlockRef {
	contentIndex: number;
	kind: "text" | "thinking" | "toolCall";
	partialJson: string;
}

export class TurnTranslator {
	private readonly blocksBySdkIndex = new Map<number, BlockRef>();
	private outcome: TurnOutcome | undefined;
	private errorMessage: string | undefined;
	private toolCallsInMessage = 0;
	private streamedUsageSeen = false;
	private localOutputRendered = false;

	constructor(
		private readonly output: AssistantMessage,
		private readonly stream: AssistantMessageEventStream,
		private readonly onToolCall: (toolUseId: string) => void,
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
		switch (sdkMessage.type) {
			case "stream_event":
				if (sdkMessage.parent_tool_use_id === null) this.handleStreamEvent(sdkMessage.event);
				return;
			case "assistant":
				if (sdkMessage.parent_tool_use_id !== null) return;
				if (sdkMessage.error) {
					this.errorMessage = SDK_ERROR_MESSAGES[sdkMessage.error] ?? `Claude error: ${sdkMessage.error}`;
					return;
				}
				if (sdkMessage.message.model === SYNTHETIC_MODEL && this.output.content.length === 0) this.renderLocalOutput(textOfBlocks(sdkMessage.message.content));
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
		this.outcome = outcome;
		this.output.stopReason = outcome;
		this.output.errorMessage = message ?? this.errorMessage;
		this.stream.push({ type: "error", reason: outcome, error: this.output });
		this.stream.end();
	}

	private handleStreamEvent(event: StreamEvent): void {
		switch (event.type) {
			case "message_start":
				this.closeOpenBlocks();
				this.toolCallsInMessage = 0;
				this.applyMessageStartUsage(event.message.usage);
				return;
			case "message_delta":
				this.applyMessageDeltaUsage(event.usage);
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

	private renderLocalOutput(rawText: string): void {
		const text = rawText.replace(LOCAL_COMMAND_TAGS, "").trim();
		if (this.localOutputRendered || text.length === 0) return;
		this.localOutputRendered = true;
		this.closeOpenBlocks();
		const contentIndex = this.output.content.length;
		this.output.content.push({ type: "text", text });
		this.stream.push({ type: "text_start", contentIndex, partial: this.output });
		this.stream.push({ type: "text_delta", contentIndex, delta: text, partial: this.output });
		this.stream.push({ type: "text_end", contentIndex, content: text, partial: this.output });
	}

	private finishForToolUse(): void {
		this.outcome = "toolUse";
		this.output.stopReason = "toolUse";
		this.stream.push({ type: "done", reason: "toolUse", message: this.output });
		this.stream.end();
	}

	private startToolCall(sdkIndex: number, toolUseId: string, toolName: string): void {
		const piToolName = piToolNameFromMcpName(toolName);
		if (piToolName === undefined && !isMirroredSdkTool(toolName)) return;
		const contentIndex = this.output.content.length;
		this.blocksBySdkIndex.set(sdkIndex, { contentIndex, kind: "toolCall", partialJson: "" });
		this.output.content.push({ type: "toolCall", id: toolUseId, name: piToolName ?? toolName, arguments: {} });
		this.onToolCall(toolUseId);
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

	private handleResult(result: Extract<SDKMessage, { type: "result" }>): void {
		this.closeOpenBlocks();
		this.applyUsage(result);
		if (result.subtype !== "success" || result.is_error) {
			const detail = result.subtype === "success" ? result.result : result.errors?.join("\n");
			this.finish("error", this.errorMessage ?? (detail || `Claude run ended with ${result.subtype}`));
			return;
		}
		const reason = result.stop_reason === "max_tokens" ? "length" : "stop";
		this.outcome = reason;
		this.output.stopReason = reason;
		this.stream.push({ type: "done", reason, message: this.output });
		this.stream.end();
	}

	private applyMessageStartUsage(usage: { input_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined): void {
		if (!usage) return;
		this.streamedUsageSeen = true;
		const target = this.output.usage;
		target.input += usage.input_tokens ?? 0;
		target.cacheRead += usage.cache_read_input_tokens ?? 0;
		target.cacheWrite += usage.cache_creation_input_tokens ?? 0;
		this.refreshTotalTokens();
	}

	private applyMessageDeltaUsage(usage: { output_tokens?: number | null } | undefined): void {
		if (!usage) return;
		this.streamedUsageSeen = true;
		this.output.usage.output += usage.output_tokens ?? 0;
		this.refreshTotalTokens();
	}

	private refreshTotalTokens(): void {
		const usage = this.output.usage;
		usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	}

	private applyUsage(result: Extract<SDKMessage, { type: "result" }>): void {
		const usage = this.output.usage;
		usage.cost.total = result.total_cost_usd ?? 0;
		if (this.streamedUsageSeen) return;
		usage.input = result.usage.input_tokens ?? 0;
		usage.output = result.usage.output_tokens ?? 0;
		usage.cacheRead = result.usage.cache_read_input_tokens ?? 0;
		usage.cacheWrite = result.usage.cache_creation_input_tokens ?? 0;
		this.refreshTotalTokens();
	}
}
