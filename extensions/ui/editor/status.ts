/**
 * Working-status tracker — what the agent is doing right now, as one short
 * label with a run clock, the live output-token estimate, and the live rate.
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
 * stream usage. The rate divides the estimate by the elapsed run time, so it
 * is a run average, not a per-second instantaneous rate.
 *
 * Formatting is the caller's job (`parts()`), so the tracker stays theme-free.
 */

import type {
	AgentEndEvent,
	AgentStartEvent,
	MessageUpdateEvent,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { formatTokens } from "../../../shared/format.ts";
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
 * Track one agent run: phase, start time, streamed characters, and the
 * in-flight top-level tools. Feed it pi's events; call `parts()` for the
 * numbers the loading widget draws.
 */
export class WorkingStatusTracker {
	/** Tool-name → gerund, seeded from settings (`editor.toolVerbs`). */
	private readonly verbs: Map<string, string>;
	/** Injectable wall clock, so tests can drive time. */
	private readonly now: () => number;
	private phase: WorkingPhase = "prompting";
	private startedAt = 0;
	/** Characters streamed so far this run, across every delta kind. */
	private streamedChars = 0;
	/** Top-level executions in flight, as `toolCallId → label` pairs. */
	private runningTools = new Map<string, string>();

	constructor(verbs: Record<string, string>, now: () => number = Date.now) {
		this.verbs = new Map(Object.entries(verbs));
		this.now = now;
	}

	/** The agent loop started; reset the run clock and the character counter. */
	onAgentStart(_event: AgentStartEvent): void {
		this.startedAt = this.now();
		this.streamedChars = 0;
		this.phase = "prompting";
	}

	/** Derive the phase and grow the streamed-character counter from one update. */
	onMessageUpdate({ assistantMessageEvent }: MessageUpdateEvent): void {
		const event = assistantMessageEvent;
		if (!event) return;
		// Every streamed delta is output the model produced: prose, thinking,
		// and tool-call JSON alike. Count their characters; the token estimate
		// divides by four below.
		if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
			this.streamedChars += event.delta.length;
		}
		if (event.type === "thinking_delta") this.phase = "thinking";
		else if (event.type === "text_delta") this.phase = "answering";
		else if (event.type === "toolcall_start" || event.type === "toolcall_delta") this.phase = "staging";
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

	/** The agent loop ended; the label drops back to prompting for the next run. */
	onAgentEnd(_event: AgentEndEvent): void {
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

	/** The line's pieces, for callers that color segments individually.
	 *  `tps` is undefined until both a positive elapsed time and at least one
	 *  streamed character exist — no rate without something to divide. */
	parts(now = this.now()): {
		label: string;
		elapsed: string;
		elapsedMs: number;
		tokens: string;
		tps: number | undefined;
	} {
		const elapsedMs = this.elapsedMs;
		const tokens = this.tokens;
		const seconds = elapsedMs / 1000;
		const tps = seconds > 0 && tokens > 0 ? tokens / seconds : undefined;
		return {
			label: this.label,
			elapsed: formatCountdown(elapsedMs),
			elapsedMs,
			tokens: formatTokens(tokens),
			tps,
		};
	}
}
