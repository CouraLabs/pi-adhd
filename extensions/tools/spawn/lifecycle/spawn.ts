/**
 * spawn.ts — Spawn class: identity, lifecycle status, and per-spawn behavior.
 *
 * Status/stats are delegated to the SpawnState value object; listener
 * lifecycle to RunListeners; workspace prepare/dispose to WorkspaceBracket.
 * Behavior (abort) lives here rather than on SpawnManager.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { debugLog } from "../debug.ts";
import type { CreateSpawnSessionParams } from "./create-spawn-session.ts";
import type { ParentSnapshot } from "./parent-snapshot.ts";
import { subscribeSpawnObserver } from "./record-observer.ts";
import { RunListeners } from "./run-listeners.ts";
import type { SpawnSession, TurnLoopResult } from "./spawn-session.ts";
import { type CarrierClaim, SpawnState, type SpawnStatus } from "./spawn-state.ts";
import { type TurnBudget, wrappedUpAtTurnLimit } from "./turn-limits.ts";
import type { LifetimeUsage } from "./usage.ts";
import type { WorkspaceProvider } from "./workspace.ts";
import { WorkspaceBracket } from "./workspace-bracket.ts";
import type { RunConfig } from "../runtime.ts";
import type { CompactionInfo, ParentSessionInfo, SessionMessage, SpawnType, ThinkingLevel } from "../types.ts";

/** Per-spawn lifecycle observer — created by SpawnManager for each spawn. */
export interface SpawnLifecycleObserver {
	/** Fires when the spawn transitions to running (inside run(), after markRunning). */
	onStarted?(agent: Spawn): void;
	/** Fires once the session is created — the spawn's spawnSession is now available. */
	onSessionCreated?(agent: Spawn): void;
	/** Fires once when the run completes or fails (for concurrency drain). */
	onRunFinished?(agent: Spawn): void;
	/**
	 * Fires once a resumed run is under way — after the record is rewound, so a
	 * subscriber reading it sees the run that just started rather than the
	 * outcome of the one it replaced.
	 */
	onResumeStarted?(agent: Spawn): void;
	/** Fires once when a resumed run reaches a terminal state. */
	onResumeFinished?(agent: Spawn): void;
	/**
	 * Fires when a teardown after the agent's result was delivered reported where
	 * its work went. Not fired for a failed run or resume: those reach a terminal
	 * notification of their own, which carries the notice.
	 */
	onWorkspaceNotice?(agent: Spawn, notice: string): void;
	/** Fires on compaction events during the run. */
	onCompacted?(agent: Spawn, info: CompactionInfo): void;
}

export type { SpawnStatus } from "./spawn-state.ts";

/**
 * Why a resume of an agent would be refused.
 *
 * One vocabulary for a fact three record-level conditions used to answer
 * separately: the resume door decided it from `isSessionReady()`,
 * `sessionReleased`, and `workspaceDisposed`, while the result carriers never
 * consulted any of them and advertised the resume regardless.
 *
 * `still-running` is the one transient member: it is a refusal of *now* rather
 * than of ever, and the carriers word it accordingly.
 */
export type ResumeRefusal =
	| "still-running"
	| "no-session"
	| "session-released"
	| "workspace-disposed";

/**
 * The execution machinery a Spawn needs to run. A single mandatory
 * collaborator: production (SpawnManager.spawn) always supplies it, so run()
 * needs no "not configured" guards. The genuinely-optional behavior knobs stay
 * optional; the four inputs run() cannot proceed without are required.
 */
export interface SpawnExecution {
	/** Assembly factory that produces a born-complete SpawnSession. */
	createSpawnSession: (params: CreateSpawnSessionParams) => Promise<SpawnSession>;
	/** Immutable spawn-time parent snapshot handed to the session factory. */
	snapshot: ParentSnapshot;
	/** Initial prompt for the turn loop. */
	prompt: string;
	/** Parent working directory handed to a workspace provider's prepare(). */
	baseCwd: string;
	observer?: SpawnLifecycleObserver;
	getRunConfig?: () => RunConfig;
	/** Resolves the registered workspace provider (if any) at run-start. */
	getWorkspaceProvider?: () => WorkspaceProvider | undefined;
	model?: Model<any>;
	maxTurns?: number;
	thinkingLevel?: ThinkingLevel;
	parentSession?: ParentSessionInfo;
	signal?: AbortSignal;
}

export interface SpawnInit {
	// Identity
	id: string;
	type: SpawnType;
	description: string;

	/** Execution machinery — always supplied; construct-complete, no test fallbacks. */
	execution: SpawnExecution;

	/** Lifecycle status and metrics. Defaults to a fresh running state. */
	state?: SpawnState;
}

export class Spawn {
	// Identity — set once at construction
	readonly id: string;
	readonly type: SpawnType;
	readonly description: string;

	// Lifecycle status and metrics — owned by a private value object; getters and
	// mutation methods below delegate to it one line.
	private readonly state: SpawnState;
	get status(): SpawnStatus { return this.state.status; }
	get result(): string | undefined { return this.state.result; }
	get error(): string | undefined { return this.state.error; }
	get startedAt(): number { return this.state.startedAt; }
	get completedAt(): number | undefined { return this.state.completedAt; }
	get consumedAt(): number | undefined { return this.state.consumedAt; }
	get consumed(): boolean { return this.state.consumed; }
	get claimed(): boolean { return this.state.claimed; }
	get pendingQuestion(): string | undefined { return this.state.pendingQuestion; }
	/**
	 * What the workspace reported at a teardown with no result text to fold it
	 * into — the provider's own wording for where the child's work ended up.
	 *
	 * Undefined for a run that completed normally: there the addendum rides the
	 * result, and duplicating it here would have every carrier report it twice.
	 */
	get workspaceNotice(): string | undefined { return this.state.workspaceNotice; }
	get turnBudget(): TurnBudget | undefined { return this.state.turnBudget; }
	get toolUses(): number { return this.state.toolUses; }
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this.state.lifetimeUsage; }
	get compactionCount(): number { return this.state.compactionCount; }
	get activeTools(): ReadonlyMap<string, string> { return this.state.activeTools; }
	get responseText(): string { return this.state.responseText; }
	get lastProgressAt(): number { return this.state.lastProgressAt; }
	isActive(): boolean { return this.state.isActive(); }
	isTerminalError(): boolean { return this.state.isTerminalError(); }
	isRunning(): boolean { return this.state.isRunning(); }

	private _abortController: AbortController;
	/** Cancels whichever run is current. */
	get abortController(): AbortController { return this._abortController; }
	private _promise?: Promise<void>;
	/** Handle on the agent's current run — the initial run, or the live resume that replaced it. */
	get promise(): Promise<void> | undefined { return this._promise; }

	private readonly execution: SpawnExecution;
	private readonly listeners = new RunListeners();
	private readonly workspaceBracket: WorkspaceBracket;

	spawnSession?: SpawnSession;

	// Retained after releaseSession() disposes the heavy session, so outputFile
	// (transcript pointer) survives and the resume path can tell "released" from
	// "never had a session."
	private _releasedOutputFile?: string;
	private _releasedModel?: Model<any>;
	private _releasedThinkingLevel?: ThinkingLevel;
	private _sessionReleased = false;
	/** True once releaseSession() has freed a live session (distinct from never having had one). */
	get sessionReleased(): boolean { return this._sessionReleased; }

	/**
	 * True once this agent's provider-supplied workspace has been torn down.
	 * False for an agent that never had one, so it names the resume the session
	 * would re-enter a removed directory for — not merely a session with a
	 * workspace provider registered.
	 */
	get workspaceDisposed(): boolean { return this.workspaceBracket.wasDisposed(); }

	/**
	 * Path to the agent's session JSONL file, or undefined if not yet available.
	 * Falls back to the path captured at releaseSession() once the live session is gone.
	 */
	get outputFile(): string | undefined {
		return this.spawnSession?.outputFile ?? this._releasedOutputFile;
	}

	/**
	 * The model this agent runs: the live session's (so a mid-run switch shows),
	 * then the one captured at releaseSession(), then the spawn override.
	 * Undefined for an inherited model until the session exists.
	 */
	get model(): Model<any> | undefined {
		return this.spawnSession?.model ?? this._releasedModel ?? this.execution.model;
	}

	/** The thinking level this agent runs at, resolved in the same order as `model`. */
	get thinkingLevel(): ThinkingLevel | undefined {
		return this.spawnSession?.thinkingLevel ?? this._releasedThinkingLevel ?? this.execution.thinkingLevel;
	}

	/** The tool call ID of the `spawn` call that spawned this child, if any. */
	get toolCallId(): string | undefined {
		return this.execution.parentSession?.toolCallId;
	}

	/** Returns true when a SpawnSession is available (session is ready). */
	isSessionReady(): boolean {
		return this.spawnSession != null;
	}

	/**
	 * Why a resume of this agent would be refused, or undefined when one would be
	 * accepted.
	 *
	 * The conditions are checked in the order the resume door checks them, so a
	 * record whose session was released *and* whose workspace is gone reports the
	 * session — the door's message for it names the retention window, which is
	 * the fact that explains both. A live run outranks all of them: nothing about
	 * a settled record is decided yet.
	 *
	 * A getter rather than a predicate method because the result carriers read it
	 * as a field: `OutcomeAddenda` and `AgentReport` both declare it, and a live
	 * record satisfies them structurally only if it is a property.
	 */
	get resumeRefusal(): ResumeRefusal | undefined {
		// Before the session check: a run transitions to running before it creates
		// its session, and "still running" describes that record better than "no
		// session" does.
		if (this.isRunning()) return "still-running";
		if (!this.isSessionReady()) return this._sessionReleased ? "session-released" : "no-session";
		if (this.workspaceDisposed) return "workspace-disposed";
		return undefined;
	}

	/** Return the session conversation as formatted text, or undefined if no session. */
	getConversation(): string | undefined {
		return this.spawnSession?.getConversation();
	}

	/** Return the session context window utilization (0-100), or null if unavailable. */
	getContextPercent(): number | null {
		return this.spawnSession?.getContextPercent() ?? null;
	}

	/**
	 * Subscribe to session events for live updates (e.g., conversation viewer).
	 * Returns an unsubscribe function, or undefined if no session is available.
	 */
	subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined {
		return this.spawnSession?.subscribe(fn);
	}

	/** The session's message history, or an empty array if no session. */
	get messages(): readonly unknown[] {
		return this.spawnSession?.messages ?? [];
	}

	/** The session's message history typed for Pi's session-rendering machinery, or empty if no session. */
	get agentMessages(): readonly SessionMessage[] {
		return this.spawnSession?.agentMessages ?? [];
	}

	/** Resolve a registered tool definition by name, or undefined if no session. */
	getToolDefinition(name: string): ToolDefinition | undefined {
		return this.spawnSession?.getToolDefinition(name);
	}

	constructor(init: SpawnInit) {
		// Identity
		this.id = init.id;
		this.type = init.type;
		this.description = init.description;

		// Lifecycle status and metrics — fresh running state unless one is supplied
		this.state = init.state ?? new SpawnState();

		// Abort controller — always created, never injected
		this._abortController = new AbortController();

		// Execution machinery — a single mandatory collaborator
		this.execution = init.execution;

		// Per-run lifecycle collaborators
		this.workspaceBracket = new WorkspaceBracket(
			this.execution.getWorkspaceProvider ?? (() => undefined),
		);
	}

	/**
	 * Execute the full agent lifecycle: workspace preparation, session creation
	 * via the factory, observer wiring, the turn loop, workspace disposal, and
	 * status transitions.
	 *
	 * Execution is supplied at construction (mandatory), so run() needs no
	 * "not configured" guards. The returned promise always resolves (errors are
	 * captured internally).
	 */
	async run(): Promise<void> {
		this._abortController = new AbortController();
		this.markRunning(Date.now());
		this.execution.observer?.onStarted?.(this);
		this.listeners.wireSignal(this.execution.signal, () => this.abort());

		// Guard the await so the no-provider path stays synchronous, preserving
		// the original run() timing: the factory is called in the same turn as
		// spawn() when no workspace provider is registered.
		let cwd: string | undefined;
		if (this.workspaceBracket.hasProvider()) {
			try {
				cwd = await this.workspaceBracket.prepare({
					agentId: this.id,
					agentType: this.type,
					baseCwd: this.execution.baseCwd,
				});
			} catch (err) {
				this.markError(err);
				this.listeners.release();
				this.execution.observer?.onRunFinished?.(this);
				return;
			}
		}

		const runConfig = this.execution.getRunConfig?.();
		if (this.stoppedBeforeFirstTurn()) return;
		try {
			this.spawnSession = await this.execution.createSpawnSession({
				snapshot: this.execution.snapshot,
				type: this.type,
				cwd,
				parentSession: this.execution.parentSession,
				model: this.execution.model,
				thinkingLevel: this.execution.thinkingLevel,
				askParent: (question) => { this.state.setPendingQuestion(question); },
			});
		} catch (err) {
			// The factory disposed its own session on a post-creation failure.
			this.failRun(err);
			return;
		}

		this.listeners.attachObserver(subscribeSpawnObserver(this.spawnSession, this.state, {
			onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
		}));
		this.execution.observer?.onSessionCreated?.(this);

		if (this.stoppedBeforeFirstTurn()) return;

		try {
			const result = await this.spawnSession.runTurnLoop(this.execution.prompt, {
				maxTurns: this.execution.maxTurns,
				defaultMaxTurns: runConfig?.defaultMaxTurns,
				wrapUpTurns: runConfig?.wrapUpTurns,
				signal: this.abortController.signal,
				onTurnBudget: (budget) => { this.state.setTurnBudget(budget); },
			});
			this.completeRun(result);
		} catch (err) {
			this.failRun(err);
		}
	}

	/**
	 * Start execution. Stores the run promise so it is awaitable via the
	 * `promise` getter.
	 */
	start(): void {
		this._promise = this.run();
	}

	/**
	 * Resume an existing session with a new prompt, managing the observer
	 * subscription lifecycle internally (same wiring as run()).
	 *
	 * Requires an existing SpawnSession (set when the original run created it).
	 * The returned promise always resolves (errors are captured internally) and is
	 * published as the `promise` getter, so waiters track the resume rather than
	 * the settled handle of the original run.
	 *
	 * A resume runs under the record's own controller, like the initial run: the
	 * controller is reminted per run, so a record aborted on its original run does
	 * not resume under a spent one. A caller's `signal` is wired to abort() rather
	 * than forwarded to the turn loop, so both levers stop the same run and both
	 * leave the record reading `stopped`.
	 */
	resume(prompt: string, signal?: AbortSignal): Promise<void> {
		const spawnSession = this.spawnSession;
		if (!spawnSession) {
			// Rejection, not a throw: this method is not async, and a synchronous
			// throw would escape a caller's `.rejects` assertion.
			return Promise.reject(new Error("Spawn not configured for resume — missing session"));
		}

		this._promise = this.runResume(spawnSession, prompt, signal);
		return this._promise;
	}

	/** The resume body. Always resolves — errors terminate through failResume(). */
	private async runResume(spawnSession: SpawnSession, prompt: string, signal?: AbortSignal): Promise<void> {
		this._abortController = new AbortController();
		// After resetForResume, which releases the previous run's listener handles.
		this.resetForResume(Date.now());
		this.listeners.wireSignal(signal, () => this.abort());
		this.execution.observer?.onResumeStarted?.(this);
		this.listeners.attachObserver(subscribeSpawnObserver(spawnSession, this.state, {
			onCompact: (info) => this.execution.observer?.onCompacted?.(this, info),
		}));

		if (this.stoppedBeforeFirstTurn(true)) return;

		try {
			this.completeResume(await spawnSession.resumeTurnLoop(prompt, {
				signal: this.abortController.signal,
				onTurnBudget: (budget) => { this.state.setTurnBudget(budget); },
			}));
		} catch (err) {
			this.failResume(err);
		}
	}

	/** Terminate a resume as completed: mark, dispose or hold the workspace, release listeners, notify observer. */
	completeResume(result: TurnLoopResult): void {
		// The harness ending the resume at its turn limit ends the run for good,
		// as it does for an initial run.
		const exhausted = result.turnBudget.phase === "exhausted";
		// A run the operator stopped while the turn loop was settling is not a
		// completion: report the record's own terminal status to the provider.
		const finalStatus: SpawnStatus = this.isRunning() ? (exhausted ? "aborted" : "completed") : this.status;
		// A child answering one question may need to ask another, which holds the
		// workspace for the next resume the same way the original run did.
		const holdForResume =
			!exhausted && this.pendingQuestion !== undefined && finalStatus === "completed";
		const finalResult = holdForResume
			? result.responseText
			: result.responseText + this.disposeWorkspaceFolded(finalStatus);
		if (exhausted) this.markAborted(finalResult);
		else this.markCompleted(finalResult);
		this.listeners.release();
		this.execution.observer?.onResumeFinished?.(this);
	}

	/** Terminate a resume as errored: mark, release listeners, best-effort workspace dispose, notify observer. */
	failResume(err: unknown): void {
		this.markError(err);
		this.clearPendingQuestion();
		this.listeners.release();
		this.disposeWorkspaceQuietly("error");
		this.execution.observer?.onResumeFinished?.(this);
	}

	/** Transition to running state. Sets status and startedAt. */
	markRunning(startedAt: number): void {
		this.state.markRunning(startedAt);
	}

	/**
	 * Transition to completed state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markCompleted(result: string, completedAt?: number): void {
		this.state.markCompleted(result, completedAt);
	}

	/**
	 * Transition to aborted state.
	 * Always sets result and completedAt (??=). Only changes status if not stopped.
	 */
	markAborted(result: string, completedAt?: number): void {
		this.state.markAborted(result, completedAt);
	}

	/**
	 * Transition to error state.
	 * Always sets error (formatted) and completedAt (??=). Only changes status if not stopped.
	 */
	markError(error: unknown, completedAt?: number): void {
		this.state.markError(error, completedAt);
	}

	/** Transition to stopped state. Always valid — no guard. */
	markStopped(completedAt?: number): void {
		this.state.markStopped(completedAt);
	}

	/** Record the parent collected this agent's outcome. Idempotent. */
	markConsumed(at?: number): void {
		this.state.markConsumed(at);
	}

	/**
	 * A carrier has committed to delivering this outcome; nothing else announces
	 * it. The returned handle lets a carrier that abandons its commitment (a
	 * waiter whose parent turn was interrupted) drop only its own.
	 */
	claim(): CarrierClaim {
		return this.state.claim();
	}

	/**
	 * No carrier holds this outcome; announcing is owed again. Called when a
	 * resume nobody claims starts (SpawnManager.startResume), clearing the
	 * claims previous carriers left after they delivered.
	 */
	releaseClaims(): void {
		this.state.releaseClaims();
	}

	/**
	 * Abort a running agent: fire the current run's AbortController and transition
	 * to stopped. The controller is reminted at the start of each run and resume,
	 * so the lever always reaches whichever run is in flight.
	 * Returns false if the agent is not running.
	 */
	abort(): boolean {
		if (!this.isRunning()) return false;
		this.abortController.abort();
		this.markStopped();
		return true;
	}

	/** Reset for resume: running status, new startedAt, clear completedAt/result/error/consumedAt/listeners. */
	resetForResume(startedAt: number): void {
		this.state.resetForResume(startedAt);
		this.listeners.release();
	}

	/** Complete a run: release listeners, dispose the workspace, status transition, notify observer. */
	completeRun(result: TurnLoopResult): void {
		this.listeners.release();

		// The harness ending the run at its turn limit is the one way a run that
		// returned is not complete.
		const exhausted = result.turnBudget.phase === "exhausted";
		// A run the operator stopped while the turn loop was settling is not a
		// completion: report the record's own terminal status to the provider.
		const finalStatus: SpawnStatus = this.isRunning() ? (exhausted ? "aborted" : "completed") : this.status;
		// A completed child that declared a question is inviting a resume, so its
		// workspace stays live for the resume to re-enter. Every other outcome ends
		// the run for good and tears it down here, including a run that wrapped up
		// at its turn limit. The question was recorded by ask_parent during the
		// run, so it is already on the record here.
		const holdForResume =
			finalStatus === "completed" &&
			this.pendingQuestion !== undefined &&
			!wrappedUpAtTurnLimit({ status: finalStatus, turnBudget: result.turnBudget });
		// The disposal goes through the guarded helper: a throwing provider must
		// degrade to a notice, not convert a finished child's run into an error
		// and discard its result text.
		const finalResult = holdForResume
			? result.responseText
			: result.responseText + this.disposeWorkspaceFolded(finalStatus);

		if (exhausted) this.markAborted(finalResult);
		else this.markCompleted(finalResult);

		this.execution.observer?.onRunFinished?.(this);
	}

	/**
	 * Dispose the wrapped session, firing the `disposed` lifecycle event.
	 * Resolves once the child's extensions have shut down; a failing teardown is
	 * swallowed so the caller's remaining cleanup still runs.
	 */
	async disposeSession(): Promise<void> {
		this.disposeHeldWorkspace();
		await disposeQuietly(this.spawnSession, "child session dispose");
	}

	/**
	 * Release the heavy session while keeping the record: capture the transcript
	 * pointer, dispose the session (firing `disposed`), clear it, and mark released.
	 * A no-op once the session is gone — the retention sweep may call it repeatedly.
	 *
	 * The record's own state is updated before the teardown is awaited, so a sweep
	 * tick arriving mid-teardown sees a released record rather than starting a
	 * second one.
	 */
	async releaseSession(): Promise<void> {
		const session = this.spawnSession;
		if (!session) return;
		this.disposeHeldWorkspace();
		this._releasedOutputFile = session.outputFile;
		this._releasedModel = session.model;
		this._releasedThinkingLevel = session.thinkingLevel;
		this.spawnSession = undefined;
		this._sessionReleased = true;
		await disposeQuietly(session, "child session release");
	}

	/** Fail a run: mark error, release listeners, best-effort workspace dispose, notify observer. */
	failRun(err: unknown): void {
		this.markError(err);
		this.clearPendingQuestion();
		this.listeners.release();
		this.disposeWorkspaceQuietly("error");
		this.execution.observer?.onRunFinished?.(this);
	}

	/**
	 * Tear down a run whose signal was already aborted before its first turn —
	 * an operator stop that landed during workspace prepare or session creation.
	 * abort() has already marked the record stopped; this only releases the
	 * expensive resources the run had gathered so far. Returns whether the run
	 * was in fact stopped, so the caller can skip the turn loop. The terminal
	 * notification follows the run kind: a resume reports through
	 * `onResumeFinished` so `spawn:completed`/`spawn:failed` subscribers keep
	 * their once-per-run semantics.
	 */
	private stoppedBeforeFirstTurn(resume = false): boolean {
		if (!this.abortController.signal.aborted) return false;
		this.listeners.release();
		void this.disposeSession();
		if (resume) this.execution.observer?.onResumeFinished?.(this);
		else this.execution.observer?.onRunFinished?.(this);
		return true;
	}

	/**
	 * Drop a question the child recorded before the run failed.
	 *
	 * Every carrier renders a pending question as "answer by resuming me", which
	 * is not the right next action after a failure — and the failure text already
	 * tells the parent to look. An aborted run keeps its question:
	 * those reached a terminal transition with an outcome to report.
	 */
	private clearPendingQuestion(): void {
		this.state.setPendingQuestion(undefined);
	}

	/**
	 * Tear down a workspace still held once the agent's run is over — the child
	 * asked a question nobody answered, and its session is now going away.
	 *
	 * A no-op while the agent is active: an in-flight run's own terminal
	 * transition owns disposal, and pulling the directory out from under a live
	 * child is not this path's business.
	 */
	private disposeHeldWorkspace(): void {
		if (this.isActive()) return;
		// Announce what *this* disposal produced, not what the record holds: both
		// release and teardown reach here, and the second finds nothing to dispose.
		const notice = this.disposeWorkspaceQuietly(this.status);
		if (notice) this.execution.observer?.onWorkspaceNotice?.(this, notice);
	}

	/**
	 * Dispose the workspace without letting a provider failure escape. Used on
	 * the failure paths and on the success paths' disposal in completeRun and
	 * completeResume, so a throwing provider degrades to a debug note instead of
	 * converting a finished run into an error or losing its result text.
	 */
	private disposeWorkspaceQuietly(status: SpawnStatus): string {
		try {
			const notice = this.workspaceBracket.dispose({ status, description: this.description });
			if (notice) this.state.setWorkspaceNotice(notice);
			return notice;
		} catch (err) { debugLog(`workspace dispose (${status})`, err); return ""; }
	}

	/**
	 * Dispose the workspace on a path that folds the addendum into result text
	 * (completeRun/completeResume). The addendum rides the result, so unlike
	 * {@link disposeWorkspaceQuietly} it must NOT also be recorded as the
	 * record's workspace notice — every carrier would report it a second time.
	 */
	private disposeWorkspaceFolded(status: SpawnStatus): string {
		try {
			return this.workspaceBracket.dispose({ status, description: this.description });
		} catch (err) { debugLog(`workspace dispose (${status})`, err); return ""; }
	}
}

/**
 * Tear a child session down without letting its failure escape.
 * Both teardown paths are cleanup: a child that will not shut down cleanly must
 * not stop the caller from finishing the rest of its own cleanup.
 */
async function disposeQuietly(
	session: SpawnSession | undefined,
	context: string,
): Promise<void> {
	try {
		await session?.dispose();
	} catch (err) {
		debugLog(context, err);
	}
}
