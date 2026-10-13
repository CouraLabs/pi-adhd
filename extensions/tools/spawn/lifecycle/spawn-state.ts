/**
 * spawn-state.ts — SpawnState value object: lifecycle status, metrics, and live activity.
 *
 * Owns the passive, readable state of a spawn — status, result, error,
 * timestamps, stats (toolUses, lifetimeUsage, compactionCount), and live-activity
 * fields (activeTools, responseText) and the live turn budget — together with the transition
 * methods (markRunning, markCompleted, …), accumulation methods
 * (incrementToolUses, addUsage, incrementCompactions), and live-activity
 * transition methods (setTurnBudget, addActiveTool, removeActiveTool,
 * resetResponseText, appendResponseText, markProgress) that mutate them.
 *
 * State is encapsulated behind getters; external code reads through them but
 * mutates only via the transition/accumulation methods. The value object owns
 * all of its own mutations — no field is written from outside.
 *
 * Spawn holds one of these privately and delegates its getters and mutation
 * methods to it. Extracting it lets the lifecycle state machine and the
 * session-event observer be unit-tested without constructing an executor.
 */

import type { TurnBudget } from "./turn-limits.ts";
import type { LifetimeUsage } from "./usage.ts";
import { addUsage } from "./usage.ts";

export type SpawnStatus =
	| "running"
	| "completed"
	| "aborted"
	| "stopped"
	| "error";

/**
 * One carrier's commitment to deliver an outcome. Releasing it drops only this
 * commitment, so the outcome stays claimed while any other carrier holds one.
 */
export interface CarrierClaim {
	release(): void;
}

// ---- Status classification predicates ----
// The single decision point for the re-derived status groupings. Instance
// methods on SpawnState delegate here; DTO consumers holding a bare
// SpawnStatus (no SpawnState instance) call these directly.

/** Running — the agent is still live. */
export function isActiveStatus(status: SpawnStatus): boolean {
	return status === "running";
}

/** Terminated by error, harness turn-limit abort, or external stop. */
export function isTerminalErrorStatus(status: SpawnStatus): boolean {
	return status === "error" || status === "stopped" || status === "aborted";
}

/** Actively running. */
export function isRunningStatus(status: SpawnStatus): boolean {
	return status === "running";
}

export interface SpawnStateInit {
	status?: SpawnStatus;
	result?: string;
	/** The question the agent ended its turn with — an outcome fact, like result. */
	pendingQuestion?: string;
	/** What a teardown with no result text reported — an outcome fact, like result. */
	workspaceNotice?: string;
	/** The run's turn limit and its use — an outcome fact, like result. */
	turnBudget?: TurnBudget;
	error?: string;
	startedAt?: number;
	/** When the run last made progress; defaults to startedAt. */
	lastProgressAt?: number;
	completedAt?: number;
	/** Time the parent collected the outcome; undefined = obligation still open. */
	consumedAt?: number;
	// Stats — seed a populated value without replaying the accumulation methods
	toolUses?: number;
	lifetimeUsage?: LifetimeUsage;
	compactionCount?: number;
	// Live activity — activeTools is seeded by name (each entry calls addActiveTool)
	activeTools?: string[];
	responseText?: string;
}

export class SpawnState {
	// Transition state — encapsulated behind getters, mutated only via transition methods
	private _status: SpawnStatus;
	get status(): SpawnStatus { return this._status; }

	private _result?: string;
	get result(): string | undefined { return this._result; }

	private _error?: string;
	get error(): string | undefined { return this._error; }

	private _startedAt: number;
	get startedAt(): number { return this._startedAt; }

	private _completedAt?: number;
	get completedAt(): number | undefined { return this._completedAt; }

	// Result delivery — whether the parent has collected the outcome (orthogonal to status)
	private _consumedAt?: number;
	get consumedAt(): number | undefined { return this._consumedAt; }
	get consumed(): boolean { return this._consumedAt != null; }

	// Result delivery — whether a carrier has committed to delivering the outcome.
	// Distinct from consumption in two ways. It is revocable, where consumption is
	// a one-way latch that also times session retention. And it is scoped to the
	// caller rather than the run: consumedAt records a delivery that has already
	// happened, so a resume must clear it, while a claim records one that has not
	// happened yet and stays live across the reset (see resetForResume).
	// Transient runtime ownership, so deliberately not seedable via
	// SpawnStateInit — a rehydrated record must not claim a carrier that no
	// longer exists.
	// One entry per carrier, so a carrier that abandons its commitment drops only
	// its own: another carrier holding the same outcome still delivers it.
	private readonly _claims = new Set<CarrierClaim>();
	get claimed(): boolean { return this._claims.size > 0; }

	// Which run this is: 1 for the first, one more for each resume.
	// Transient: a rehydrated record has no waiter to answer.
	private _run = 1;
	get run(): number { return this._run; }

	// The question this agent ended its turn with, if it declared one. Part of the
	// outcome like _result, and set alongside it at the terminal transition.
	private _pendingQuestion?: string;
	get pendingQuestion(): string | undefined { return this._pendingQuestion; }

	// What the workspace reported at a teardown with no result text to fold it
	// into. Part of the outcome like _result, and set at the disposal that
	// produced it. Undefined for a run whose addendum rode the result instead.
	private _workspaceNotice?: string;
	get workspaceNotice(): string | undefined { return this._workspaceNotice; }

	// The run's turn budget, live: the turn loop reports it before the first turn
	// and after each boundary, so the last report is already the outcome's. Part
	// of the outcome like _result, and cleared where a run begins (resetForResume).
	private _turnBudget?: TurnBudget;
	get turnBudget(): TurnBudget | undefined { return this._turnBudget; }

	// Stats — accumulated via mutation methods, readable via getters
	private _toolUses: number;
	get toolUses(): number { return this._toolUses; }

	private _lifetimeUsage: LifetimeUsage;
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this._lifetimeUsage; }

	private _compactionCount: number;
	get compactionCount(): number { return this._compactionCount; }

	// Live activity — accumulated via transition methods, readable via getters
	private _activeTools = new Map<string, string>();
	get activeTools(): ReadonlyMap<string, string> { return this._activeTools; }

	private _toolKeySeq = 0;

	private _responseText: string;
	get responseText(): string { return this._responseText; }

	/** When the current run last emitted a session event; its start until it emits one. */
	private _lastProgressAt: number;
	get lastProgressAt(): number { return this._lastProgressAt; }

	constructor(init: SpawnStateInit = {}) {
		this._status = init.status ?? "running";
		this._result = init.result;
		this._pendingQuestion = init.pendingQuestion;
		this._workspaceNotice = init.workspaceNotice;
		this._turnBudget = init.turnBudget;
		this._error = init.error;
		this._startedAt = init.startedAt ?? Date.now();
		this._lastProgressAt = init.lastProgressAt ?? this._startedAt;
		this._completedAt = init.completedAt;
		this._consumedAt = init.consumedAt;
		this._toolUses = init.toolUses ?? 0;
		// Copy so a later addUsage() cannot mutate the caller's object. Every field is
		// defaulted so a record persisted before this change still accumulates cleanly
		// instead of turning every later sum — or a rendered cache-hit rate — into NaN.
		this._lifetimeUsage = init.lifetimeUsage
			? {
				...init.lifetimeUsage,
				lastInput: init.lifetimeUsage.lastInput ?? 0,
				lastOutput: init.lifetimeUsage.lastOutput ?? 0,
				cacheRead: init.lifetimeUsage.cacheRead ?? 0,
				lastCacheRead: init.lifetimeUsage.lastCacheRead ?? 0,
				lastCacheWrite: init.lifetimeUsage.lastCacheWrite ?? 0,
				cost: init.lifetimeUsage.cost ?? 0,
			}
			: { input: 0, lastInput: 0, output: 0, lastOutput: 0, cacheRead: 0, lastCacheRead: 0, cacheWrite: 0, lastCacheWrite: 0, cost: 0 };
		this._compactionCount = init.compactionCount ?? 0;
		this._responseText = init.responseText ?? "";
		for (const name of init.activeTools ?? []) {
			this.addActiveTool(name);
		}
	}

	/** Running — still live. */
	isActive(): boolean {
		return isActiveStatus(this._status);
	}

	/** Terminated by error, harness turn-limit abort, or external stop. */
	isTerminalError(): boolean {
		return isTerminalErrorStatus(this._status);
	}

	/** Actively running. */
	isRunning(): boolean {
		return isRunningStatus(this._status);
	}

	/** Increment tool use count. Called by record-observer on tool_execution_end. */
	incrementToolUses(): void {
		this._toolUses++;
	}

	/** Accumulate a usage delta into lifetimeUsage. Called by record-observer on message_end. */
	addUsage(delta: { input: number; lastInput: number; output: number; lastOutput: number; cacheRead: number; lastCacheRead: number; cacheWrite: number; lastCacheWrite: number; cost: number }): void {
		addUsage(this._lifetimeUsage, delta);
	}

	/** Increment compaction count. Called by record-observer on compaction_end. */
	incrementCompactions(): void {
		this._compactionCount++;
	}

	/** Record a tool starting. Called by record-observer on tool_execution_start. */
	addActiveTool(toolName: string): void {
		this._activeTools.set(toolName + "_" + (++this._toolKeySeq), toolName);
	}

	/** Remove one active tool by name (first match). Called by record-observer on tool_execution_end. */
	removeActiveTool(toolName: string): void {
		for (const [key, name] of this._activeTools) {
			if (name === toolName) {
				this._activeTools.delete(key);
				break;
			}
		}
	}

	/** Reset the current response text. Called by record-observer on message_start. */
	resetResponseText(): void {
		this._responseText = "";
	}

	/** Append a text delta to the current response text. Called by record-observer on message_update. */
	appendResponseText(delta: string): void {
		this._responseText += delta;
	}

	/** Record that the run made progress. Called by record-observer on every session event. */
	markProgress(at: number = Date.now()): void {
		this._lastProgressAt = at;
	}

	/** Transition to running state. Sets status and startedAt. */
	markRunning(startedAt: number): void {
		this._status = "running";
		this._startedAt = startedAt;
		this._lastProgressAt = startedAt;
	}

	/** Record the budget the running turn loop reports. */
	setTurnBudget(budget: TurnBudget): void {
		this._turnBudget = budget;
	}

	/**
	 * Transition to completed state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markCompleted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "completed";
		}
	}

	/**
	 * Transition to aborted state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markAborted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "aborted";
		}
	}

	/**
	 * Transition to error state.
	 * Always sets error (formatted) and completedAt (??=). Only changes status if not stopped.
	 */
	markError(error: unknown, completedAt?: number): void {
		this._error = error instanceof Error ? error.message : String(error);
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "error";
		}
	}

	/**
	 * Record the parent collected the outcome. Idempotent — keeps the first
	 * collection time (??=), so a re-read does not advance the retention clock.
	 */
	markConsumed(at?: number): void {
		this._consumedAt ??= at ?? Date.now();
	}

	/** Record the question the agent ended its turn with. */
	setPendingQuestion(question: string | undefined): void {
		this._pendingQuestion = question;
	}

	/** Record what a teardown reported when no result text could carry it. */
	setWorkspaceNotice(notice: string): void {
		this._workspaceNotice = notice;
	}

	/**
	 * A carrier has committed to delivering this outcome, so nothing else should
	 * announce it. Unlike every other transition here, this one is revocable.
	 */
	claim(): CarrierClaim {
		const claim: CarrierClaim = { release: () => { this._claims.delete(claim); } };
		this._claims.add(claim);
		return claim;
	}

	/** Drop every carrier's commitment; announcing is owed again. */
	releaseClaims(): void {
		this._claims.clear();
	}

	/** Transition to stopped state. Always valid — no guard. */
	markStopped(completedAt?: number): void {
		this._status = "stopped";
		this._completedAt = completedAt ?? Date.now();
	}

	/**
	 * Reset for resume: running status, new startedAt, clear
	 * completedAt/result/error/consumedAt/turnBudget.
	 *
	 * The carrier claim deliberately survives: it belongs to the caller that asked
	 * for the resume and will deliver its outcome, not to the run being reset.
	 * Clearing it here would drop the claim before the caller could observe it,
	 * since this runs synchronously before resume() returns.
	 */
	resetForResume(startedAt: number): void {
		this._run++;
		this._status = "running";
		this._startedAt = startedAt;
		this._lastProgressAt = startedAt;
		this._completedAt = undefined;
		this._result = undefined;
		this._error = undefined;
		this._consumedAt = undefined;
		this._turnBudget = undefined;
		// A run ended by abort mid-tool never sees `tool_execution_end`, so its
		// entry would otherwise linger as phantom activity on the resumed record.
		this._activeTools.clear();
		// A resumed run answers the old question; whether it asks a new one is
		// decided when it terminates.
		this._pendingQuestion = undefined;
	}
}
