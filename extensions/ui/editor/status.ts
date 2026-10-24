/**
 * Working-status tracker — what the agent is doing right now, as one short
 * label with a run clock and the live received-token count.
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
 * Formatting is the caller's job (`text()`), so the tracker stays theme-free.
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

/** Escape hint appended to the composed status text. */
const ESCAPE_HINT = "(esc)";

/**
 * Track one agent run: phase, start time, received tokens, and the in-flight
 * top-level tools. Feed it pi's events; call `text()` for the status line.
 */
export class WorkingStatusTracker {
	/** Tool-name → gerund, seeded from settings (`editor.toolVerbs`). */
	private readonly verbs: Map<string, string>;
	/** Injectable wall clock, so tests can drive time. */
	private readonly now: () => number;
	private phase: WorkingPhase = "prompting";
	private startedAt = 0;
	private receivedTokens = 0;
	/** Top-level executions in flight, as `toolCallId → label` pairs. */
	private runningTools = new Map<string, string>();

	constructor(verbs: Record<string, string>, now: () => number = Date.now) {
		this.verbs = new Map(Object.entries(verbs));
		this.now = now;
	}

	/** The agent loop started; reset the run clock and the receive counter. */
	onAgentStart(_event: AgentStartEvent): void {
		this.startedAt = this.now();
		this.receivedTokens = 0;
		this.phase = "prompting";
	}

	/** Derive the phase and the live token count from one streaming update. */
	onMessageUpdate({ message, assistantMessageEvent }: MessageUpdateEvent): void {
		// SAFETY: only assistant messages stream usage; the union narrows on `in`.
		if ("usage" in message) {
			const streamed = message.usage?.output;
			if (streamed !== undefined) this.receivedTokens = Math.max(this.receivedTokens, streamed);
		}
		const type = assistantMessageEvent?.type;
		if (type === "thinking_delta") this.phase = "thinking";
		else if (type === "text_delta") this.phase = "answering";
		else if (type === "toolcall_start" || type === "toolcall_delta") this.phase = "staging";
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

	/** The line's pieces, for callers that color segments individually. */
	parts(now = this.now()): { label: string; elapsed: string; tokens: string } {
		const elapsed = this.startedAt > 0 ? formatCountdown(now - this.startedAt) : "0s";
		return { label: this.label, elapsed, tokens: formatTokens(this.receivedTokens) };
	}

	/** Whole status line: `Reading 12s, ↓3.4k (esc)`. */
	text(now = this.now()): string {
		const { label, elapsed, tokens } = this.parts(now);
		return `${label} ${elapsed}, ↓${tokens} ${ESCAPE_HINT}`;
	}
}
