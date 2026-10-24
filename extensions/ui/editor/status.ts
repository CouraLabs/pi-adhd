/**
 * Working-status tracker — what the agent is doing right now, as one short
 * label with a run clock, the live output-token estimate, the live rate, and
 * the time to first token.
 *
 * Phases, in the order a run hits them:
 *
 *   prompting  the round-trip before the first streamed delta arrives
 *   thinking   thinking deltas are streaming
 *   staging    a tool call is being streamed (not yet executing)
 *   tooling    a top-level tool is executing, by its verb ("Reading", …)
 *   answering  text deltas are streaming
 *
 * A tool becoming idle (every top-level execution closed) returns the phase
 * to prompting for the next round-trip. Nested calls (a codemode script's
 * `read`, for example) do not re-label the line — the parent tool already
 * owns it.
 *
 * Output tokens are a live streaming estimate, not the provider's usage
 * figure: every streamed delta character (text, thinking, and tool-call
 * JSON) accumulates into a character counter, and the token count is that
 * counter divided by four — the same chars/4 approximation pi uses for its
 * context gauge. It moves on every delta even where the provider does not
 * stream usage.
 *
 * The rate divides tokens by streaming time only. Each LLM return (one
 * assistant message) opens at `message_start` — the request sent — and its
 * span starts when the return's first token arrives, so the request round
 * trip and the first-token wait never dilute the rate. Between returns the
 * tool gap is excluded too: the rate is tokens over accumulated streaming
 * spans, live while a return streams and settled over completed spans once
 * it ends. TFT is that first-token wait, per return: it grows while the
 * current return is still waiting, then freezes at the arrival time.
 *
 * Formatting is the caller's job (`parts()`), so the tracker stays theme-free.
 */

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

/** Fallback gerund when a tool name is not in the verb map. */
const FALLBACK_VERB = "Tooling";

/** Phase labels for the wait/stream phases themselves. */
const PHASE_LABELS = {
	prompting: "Prompting",
	thinking: "Thinking",
	staging: "Tooling",
	answering: "Answering",
} as const;

/** Phases of one agent run, and the labels that display them. */
export type WorkingPhase = "prompting" | "thinking" | "staging" | "tooling" | "answering";

/** Characters per estimated token — the context gauge's approximation. */
const CHARS_PER_TOKEN = 4;

/**
 * Track one agent run: phase, start time, streamed characters, streaming
 * spans, and the in-flight top-level tools. Feed it pi's events; call
 * `parts()` for the numbers the loading widget draws.
 */
export class WorkingStatusTracker {
	/** Tool-name → gerund, seeded from settings (`editor.toolVerbs`). */
	private readonly verbs: Map<string, string>;
	/** Injectable wall clock, so tests can drive time. */
	private readonly now: () => number;
	private phase: WorkingPhase = "prompting";
	private startedAt = 0;
	/** Characters streamed so far this run, across every delta kind and return. */
	private streamedChars = 0;
	/** Request-sent time of the LLM return currently streaming; 0 when none is. */
	private returnStartedAt = 0;
	/** First-token arrival of the current return; 0 while it is still waiting. */
	private returnFirstDeltaAt = 0;
	/** Characters streamed by the return currently open, across delta kinds. */
	private returnChars = 0;
	/** Streaming spans completed by returns that already ended, in ms. */
	private totalStreamMs = 0;
	/** First-token wait of the most recently started return, in ms; 0 until one. */
	private lastTftMs = 0;
	/** Top-level executions in flight, as `toolCallId → label` pairs. */
	private runningTools = new Map<string, string>();

	constructor(verbs: Record<string, string>, now: () => number = Date.now) {
		this.verbs = new Map(Object.entries(verbs));
		this.now = now;
	}

	/** The agent loop started; reset the run clock and the counters. */
	onAgentStart(_event: AgentStartEvent): void {
		this.startedAt = this.now();
		this.streamedChars = 0;
		this.totalStreamMs = 0;
		this.lastTftMs = 0;
		this.returnStartedAt = 0;
		this.returnFirstDeltaAt = 0;
		this.phase = "prompting";
	}

	/** An LLM return began: its request is on the wire, the wait clock starts. */
	onMessageStart(event: MessageStartEvent): void {
		if (event.message.role !== "assistant") return;
		this.returnStartedAt = this.now();
		this.returnFirstDeltaAt = 0;
	}

	/** Derive the phase and grow the streamed-character counter from one update. */
	onMessageUpdate({ assistantMessageEvent }: MessageUpdateEvent): void {
		const event = assistantMessageEvent;
		if (!event) return;
		// Every streamed delta is output the model produced: prose, thinking,
		// and tool-call JSON alike. Count their characters; the token estimate
		// divides by four below.
		if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
			if (this.returnFirstDeltaAt === 0) this.markFirstToken();
			this.returnChars += event.delta.length;
			this.streamedChars += event.delta.length;
		}
		if (event.type === "thinking_delta") this.phase = "thinking";
		else if (event.type === "text_delta") this.phase = "answering";
		else if (event.type === "toolcall_start" || event.type === "toolcall_delta") this.phase = "staging";
	}

	/** First token of the current return arrived: freeze its TFT. */
	private markFirstToken(): void {
		this.returnFirstDeltaAt = this.now();
		if (this.returnStartedAt > 0) this.lastTftMs = Math.max(0, this.returnFirstDeltaAt - this.returnStartedAt);
	}

	/** The return ended: bank its streaming span and close it out. */
	onMessageEnd(event: MessageEndEvent): void {
		if (event.message.role !== "assistant") return;
		this.closeReturn();
	}

	/** Bank the open return's streaming span; safe with no return open. */
	private closeReturn(): void {
		if (this.returnFirstDeltaAt > 0) this.totalStreamMs += Math.max(0, this.now() - this.returnFirstDeltaAt);
		this.returnStartedAt = 0;
		this.returnFirstDeltaAt = 0;
		this.returnChars = 0;
	}

	/** A tool began executing: top-level tools take over the label. */
	onToolExecutionStart(event: ToolExecutionStartEvent): void {
		if (!event.parentToolCallId) {
			this.phase = "tooling";
			// SAFETY: toolCallId is a server-generated id string, unique per call.
			this.runningTools.set(event.toolCallId, this.verbFor(event.toolName));
		}
	}

	/** A tool finished; with no top-level tools left the model is being prompted again. */
	onToolExecutionEnd(event: ToolExecutionEndEvent): void {
		this.runningTools.delete(event.toolCallId);
		if (this.runningTools.size === 0) this.phase = "prompting";
	}

	/** The agent loop ended: close any still-open return and reset the labels. */
	onAgentEnd(_event: AgentEndEvent): void {
		this.closeReturn();
		this.runningTools.clear();
		this.phase = "prompting";
	}

	/** Gerund for a tool name: the verb map entry, else "Tooling". */
	private verbFor(toolName: string): string {
		return this.verbs.get(toolName.toLowerCase()) ?? FALLBACK_VERB;
	}

	/** The current leading label ("Reading") — the earliest tool still running,
	 *  so a parallel quick call does not flicker the name back and forth. */
	get label(): string {
		return this.phase === "tooling" ? (this.runningTools.values().next().value ?? FALLBACK_VERB) : PHASE_LABELS[this.phase];
	}

	/** Live output-token estimate: streamed characters divided by four. */
	get tokens(): number {
		return Math.floor(this.streamedChars / CHARS_PER_TOKEN);
	}

	/** Elapsed run milliseconds; 0 before the run started. */
	get elapsedMs(): number {
		return this.startedAt > 0 ? Math.max(0, this.now() - this.startedAt) : 0;
	}

	/** Time to first token, in ms, as the line shows it: the current return's
	 *  wait while it is still open (growing until the token lands), then the
	 *  most recent return's frozen wait. undefined before any return. */
	get tftMs(): number | undefined {
		if (this.returnStartedAt > 0 && this.returnFirstDeltaAt === 0) return Math.max(0, this.now() - this.returnStartedAt);
		return this.lastTftMs > 0 ? this.lastTftMs : undefined;
	}

	/** The line's pieces, for callers that color segments individually.
	 *  `tokens` is the raw estimate as digits — the widget draws it unformatted.
	 *  `tps` is undefined until a positive streaming span and at least one
	 *  streamed character exist — no rate without something to divide. */
	parts(now = this.now()): {
		label: string;
		elapsed: string;
		elapsedMs: number;
		tokens: string;
		tps: number | undefined;
		tftMs: number | undefined;
	} {
		const elapsedMs = this.elapsedMs;
		const tokens = this.tokens;
		// Streaming time only: completed spans plus the open return's span since
		// its first token — request time, first-token waits, and tool gaps stay
		// out of the divisor.
		const streamingMs =
			this.totalStreamMs + (this.returnFirstDeltaAt > 0 ? Math.max(0, now - this.returnFirstDeltaAt) : 0);
		const seconds = streamingMs / 1000;
		const tps = seconds > 0 && tokens > 0 ? tokens / seconds : undefined;
		return {
			label: this.label,
			elapsed: formatCountdown(elapsedMs),
			elapsedMs,
			tokens: String(tokens),
			tps,
			tftMs: this.tftMs,
		};
	}
}
