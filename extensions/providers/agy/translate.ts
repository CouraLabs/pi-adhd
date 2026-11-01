import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	Usage,
} from "@earendil-works/pi-ai";
import { agyUsageToPi } from "./wire.ts";
import type { AgyOutputEvent, AgyResult } from "./wire.ts";
import { summarizeToolStep } from "./runner.ts";

export type AgyTurnOutcome = "stop" | "error" | "aborted";

const TOOL_OUTPUT_PREVIEW_LIMIT = 400;

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createAgyAssistantShell(model: Model<Api>): AssistantMessage {
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

function truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

export class AgyTurnTranslator {
	private textIndex: number | undefined;
	private thinkingIndex: number | undefined;
	private thinkingText = "";
	private finished = false;

	constructor(
		private readonly output: AssistantMessage,
		private readonly stream: AssistantMessageEventStream,
	) {}

	handle(event: AgyOutputEvent): void {
		if (this.finished || event.kind !== "step") return;
		const step = event.step;
		if (step.step_type === "agent_response") {
			if (step.text_delta) this.appendText(step.text_delta);
			return;
		}
		if (step.step_type === "tool") {
			if (step.state === "ACTIVE") this.appendThinking(`▸ ${summarizeToolStep(step)}\n`);
			else this.appendThinking(`✓ ${summarizeToolStep(step)}${this.toolOutputPreview(step.tool_info?.output)}\n`);
			return;
		}
		if (step.step_type === "user_input") return;
		const detail = step.text_delta ?? (step.state === "DONE" ? "" : `${step.step_type}\n`);
		if (detail) this.appendThinking(detail);
	}

	finishWithResult(result: AgyResult, stderr: string, model: Model<Api>): AgyTurnOutcome {
		this.finished = true;
		this.closeBlocks();
		const usage = agyUsageToPi(result.usage);
		this.output.usage = {
			...usage,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
		if (result.status === "SUCCESS") {
			if (this.output.content.length === 0 && result.response) this.appendText(result.response);
			this.output.stopReason = "stop";
			this.output.model = model.id;
			this.stream.push({ type: "done", reason: "stop", message: this.output });
			this.stream.end();
			return "stop";
		}
		const message = result.error?.trim() || stderr.trim().split("\n").filter((line) => !line.startsWith("warning:")).join("\n").slice(0, 1000) || `agy run ended with ${result.status}`;
		this.output.stopReason = "error";
		this.output.errorMessage = message;
		this.output.model = model.id;
		this.stream.push({ type: "error", reason: "error", error: this.output });
		this.stream.end();
		return "error";
	}

	finishAborted(message?: string): void {
		if (this.finished) return;
		this.finished = true;
		this.closeBlocks();
		this.output.stopReason = "aborted";
		this.output.errorMessage = message ?? "agy turn aborted";
		this.stream.push({ type: "error", reason: "aborted", error: this.output });
		this.stream.end();
	}

	finishError(message: string): void {
		if (this.finished) return;
		this.finished = true;
		this.closeBlocks();
		this.output.stopReason = "error";
		this.output.errorMessage = message;
		this.stream.push({ type: "error", reason: "error", error: this.output });
		this.stream.end();
	}

	private toolOutputPreview(output: string | undefined): string {
		if (!output) return "";
		const cleaned = output.replace(/\r/g, "").trim();
		if (!cleaned) return "";
		return `\n  ${truncate(cleaned.split("\n").slice(0, 6).join("\n"), TOOL_OUTPUT_PREVIEW_LIMIT).split("\n").join("\n  ")}`;
	}

	private appendText(delta: string): void {
		if (delta.length === 0) return;
		if (this.thinkingIndex !== undefined) this.closeThinking();
		if (this.textIndex === undefined) {
			this.textIndex = this.output.content.length;
			this.output.content.push({ type: "text", text: "" });
			this.stream.push({ type: "text_start", contentIndex: this.textIndex, partial: this.output });
		}
		const target = this.output.content[this.textIndex];
		if (target?.type !== "text") return;
		target.text += delta;
		this.stream.push({ type: "text_delta", contentIndex: this.textIndex, delta, partial: this.output });
	}

	private appendThinking(delta: string): void {
		if (delta.length === 0) return;
		if (this.textIndex !== undefined) this.closeText();
		if (this.thinkingIndex === undefined) {
			this.thinkingIndex = this.output.content.length;
			this.output.content.push({ type: "thinking", thinking: "" });
			this.stream.push({ type: "thinking_start", contentIndex: this.thinkingIndex, partial: this.output });
		}
		const target = this.output.content[this.thinkingIndex];
		if (target?.type !== "thinking") return;
		target.thinking += delta;
		this.thinkingText += delta;
		this.stream.push({ type: "thinking_delta", contentIndex: this.thinkingIndex, delta, partial: this.output });
	}

	private closeText(): void {
		if (this.textIndex === undefined) return;
		const target = this.output.content[this.textIndex];
		const content = target?.type === "text" ? target.text : "";
		this.stream.push({ type: "text_end", contentIndex: this.textIndex, content, partial: this.output });
		this.textIndex = undefined;
	}

	private closeThinking(): void {
		if (this.thinkingIndex === undefined) return;
		this.stream.push({ type: "thinking_end", contentIndex: this.thinkingIndex, content: this.thinkingText, partial: this.output });
		this.thinkingIndex = undefined;
	}

	private closeBlocks(): void {
		this.closeText();
		this.closeThinking();
	}
}
