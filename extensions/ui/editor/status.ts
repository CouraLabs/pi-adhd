import type {
	AgentEndEvent,
	AgentStartEvent,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { formatCountdown } from "../../../shared/timers.ts";

const FALLBACK_VERB = "Tooling";

const PHASE_LABELS = {
	prompting: "Prompting",
	thinking: "Thinking",
	staging: "Tooling",
	answering: "Answering",
} as const;

export type WorkingPhase = "prompting" | "thinking" | "staging" | "tooling" | "answering";

export type WorkingTone = "prompting" | "tooling" | "streaming";

const TONE_FOR_PHASE: Record<WorkingPhase, WorkingTone> = {
	prompting: "prompting",
	thinking: "streaming",
	staging: "tooling",
	tooling: "tooling",
	answering: "streaming",
};

const CHARS_PER_TOKEN = 4;

export class WorkingStatusTracker {

	private readonly verbs: Map<string, string>;

	private readonly now: () => number;
	private phase: WorkingPhase = "prompting";
	private startedAt = 0;

	private streamedChars = 0;

	private returnStartedAt = 0;

	private returnFirstDeltaAt = 0;

	private returnChars = 0;

	private totalStreamMs = 0;

	private runningTools = new Map<string, string>();

	constructor(verbs: Record<string, string>, now: () => number = Date.now) {
		this.verbs = new Map(Object.entries(verbs));
		this.now = now;
	}

	onAgentStart(_event: AgentStartEvent): void {
		this.startedAt = this.now();
		this.streamedChars = 0;
		this.totalStreamMs = 0;
		this.returnStartedAt = 0;
		this.returnFirstDeltaAt = 0;
		this.phase = "prompting";
	}

	onMessageStart(event: MessageStartEvent): void {
		if (event.message.role !== "assistant") return;
		this.returnStartedAt = this.now();
		this.returnFirstDeltaAt = 0;
	}

	onMessageUpdate({ assistantMessageEvent }: MessageUpdateEvent): void {
		const event = assistantMessageEvent;
		if (!event) return;

		if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
			if (this.returnFirstDeltaAt === 0) this.markFirstToken();
			this.returnChars += event.delta.length;
			this.streamedChars += event.delta.length;
		}
		if (event.type === "thinking_delta") this.phase = "thinking";
		else if (event.type === "text_delta") this.phase = "answering";
		else if (event.type === "toolcall_start" || event.type === "toolcall_delta") this.phase = "staging";
	}

	private markFirstToken(): void {
		this.returnFirstDeltaAt = this.now();
	}

	onMessageEnd(event: MessageEndEvent): void {
		if (event.message.role !== "assistant") return;
		this.closeReturn();
	}

	private closeReturn(): void {
		if (this.returnFirstDeltaAt > 0) this.totalStreamMs += Math.max(0, this.now() - this.returnFirstDeltaAt);
		this.returnStartedAt = 0;
		this.returnFirstDeltaAt = 0;
		this.returnChars = 0;
	}

	onToolExecutionStart(event: ToolExecutionStartEvent): void {
		if (!event.parentToolCallId) {
			this.phase = "tooling";

			this.runningTools.set(event.toolCallId, this.verbFor(event.toolName));
		}
	}

	onToolExecutionEnd(event: ToolExecutionEndEvent): void {
		this.runningTools.delete(event.toolCallId);
		if (this.runningTools.size === 0) this.phase = "prompting";
	}

	onAgentEnd(_event: AgentEndEvent): void {
		this.closeReturn();
		this.runningTools.clear();
		this.phase = "prompting";
	}

	private verbFor(toolName: string): string {
		return this.verbs.get(toolName.toLowerCase()) ?? FALLBACK_VERB;
	}

	get label(): string {
		return this.phase === "tooling" ? (this.runningTools.values().next().value ?? FALLBACK_VERB) : PHASE_LABELS[this.phase];
	}

	get tokens(): number {
		return Math.floor(this.streamedChars / CHARS_PER_TOKEN);
	}

	get elapsedMs(): number {
		return this.startedAt > 0 ? Math.max(0, this.now() - this.startedAt) : 0;
	}

	parts(now = this.now()): {
		label: string;
		tone: WorkingTone;
		elapsed: string;
		elapsedMs: number;
		tokens: string;
		tps: number | undefined;
	} {
		const elapsedMs = this.elapsedMs;
		const tokens = this.tokens;

		const streamingMs =
			this.totalStreamMs + (this.returnFirstDeltaAt > 0 ? Math.max(0, now - this.returnFirstDeltaAt) : 0);
		const seconds = streamingMs / 1000;
		const tps = seconds > 0 && tokens > 0 ? tokens / seconds : undefined;
		return {
			label: this.label,
			tone: TONE_FOR_PHASE[this.phase],
			elapsed: formatCountdown(elapsedMs),
			elapsedMs,
			tokens: String(tokens),
			tps,
		};
	}
}
