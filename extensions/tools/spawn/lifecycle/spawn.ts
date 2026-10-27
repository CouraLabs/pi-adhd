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

export interface SpawnLifecycleObserver {

	onStarted?(agent: Spawn): void;

	onSessionCreated?(agent: Spawn): void;

	onRunFinished?(agent: Spawn): void;

	onResumeStarted?(agent: Spawn): void;

	onResumeFinished?(agent: Spawn): void;

	onWorkspaceNotice?(agent: Spawn, notice: string): void;

	onCompacted?(agent: Spawn, info: CompactionInfo): void;
}

export type { SpawnStatus } from "./spawn-state.ts";

export type ResumeRefusal =
	| "still-running"
	| "no-session"
	| "session-released"
	| "workspace-disposed";

export interface SpawnExecution {

	createSpawnSession: (params: CreateSpawnSessionParams) => Promise<SpawnSession>;

	snapshot: ParentSnapshot;

	prompt: string;

	baseCwd: string;
	observer?: SpawnLifecycleObserver;
	getRunConfig?: () => RunConfig;

	getWorkspaceProvider?: () => WorkspaceProvider | undefined;
	model?: Model<any>;
	maxTurns?: number;
	thinkingLevel?: ThinkingLevel;
	parentSession?: ParentSessionInfo;
	signal?: AbortSignal;
}

export interface SpawnInit {

	id: string;
	type: SpawnType;
	description: string;

	execution: SpawnExecution;

	state?: SpawnState;
}

export class Spawn {

	readonly id: string;
	readonly type: SpawnType;
	readonly description: string;

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

	get abortController(): AbortController { return this._abortController; }
	private _promise?: Promise<void>;

	get promise(): Promise<void> | undefined { return this._promise; }

	private readonly execution: SpawnExecution;
	private readonly listeners = new RunListeners();
	private readonly workspaceBracket: WorkspaceBracket;

	spawnSession?: SpawnSession;

	private _releasedOutputFile?: string;
	private _releasedModel?: Model<any>;
	private _releasedThinkingLevel?: ThinkingLevel;
	private _sessionReleased = false;

	get sessionReleased(): boolean { return this._sessionReleased; }

	get workspaceDisposed(): boolean { return this.workspaceBracket.wasDisposed(); }

	get outputFile(): string | undefined {
		return this.spawnSession?.outputFile ?? this._releasedOutputFile;
	}

	get model(): Model<any> | undefined {
		return this.spawnSession?.model ?? this._releasedModel ?? this.execution.model;
	}

	get thinkingLevel(): ThinkingLevel | undefined {
		return this.spawnSession?.thinkingLevel ?? this._releasedThinkingLevel ?? this.execution.thinkingLevel;
	}

	get toolCallId(): string | undefined {
		return this.execution.parentSession?.toolCallId;
	}

	isSessionReady(): boolean {
		return this.spawnSession != null;
	}

	get resumeRefusal(): ResumeRefusal | undefined {

		if (this.isRunning()) return "still-running";
		if (!this.isSessionReady()) return this._sessionReleased ? "session-released" : "no-session";
		if (this.workspaceDisposed) return "workspace-disposed";
		return undefined;
	}

	getConversation(): string | undefined {
		return this.spawnSession?.getConversation();
	}

	getContextPercent(): number | null {
		return this.spawnSession?.getContextPercent() ?? null;
	}

	subscribeToUpdates(fn: (event: AgentSessionEvent) => void): (() => void) | undefined {
		return this.spawnSession?.subscribe(fn);
	}

	get messages(): readonly unknown[] {
		return this.spawnSession?.messages ?? [];
	}

	get agentMessages(): readonly SessionMessage[] {
		return this.spawnSession?.agentMessages ?? [];
	}

	getToolDefinition(name: string): ToolDefinition | undefined {
		return this.spawnSession?.getToolDefinition(name);
	}

	constructor(init: SpawnInit) {

		this.id = init.id;
		this.type = init.type;
		this.description = init.description;

		this.state = init.state ?? new SpawnState();

		this._abortController = new AbortController();

		this.execution = init.execution;

		this.workspaceBracket = new WorkspaceBracket(
			this.execution.getWorkspaceProvider ?? (() => undefined),
		);
	}

	async run(): Promise<void> {
		this._abortController = new AbortController();
		this.markRunning(Date.now());
		this.execution.observer?.onStarted?.(this);
		this.listeners.wireSignal(this.execution.signal, () => this.abort());

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

	start(): void {
		this._promise = this.run();
	}

	resume(prompt: string, signal?: AbortSignal): Promise<void> {
		const spawnSession = this.spawnSession;
		if (!spawnSession) {

			return Promise.reject(new Error("Spawn not configured for resume — missing session"));
		}

		this._promise = this.runResume(spawnSession, prompt, signal);
		return this._promise;
	}

	private async runResume(spawnSession: SpawnSession, prompt: string, signal?: AbortSignal): Promise<void> {
		this._abortController = new AbortController();

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

	completeResume(result: TurnLoopResult): void {

		const exhausted = result.turnBudget.phase === "exhausted";

		const finalStatus: SpawnStatus = this.isRunning() ? (exhausted ? "aborted" : "completed") : this.status;

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

	failResume(err: unknown): void {
		this.markError(err);
		this.clearPendingQuestion();
		this.listeners.release();
		this.disposeWorkspaceQuietly("error");
		this.execution.observer?.onResumeFinished?.(this);
	}

	markRunning(startedAt: number): void {
		this.state.markRunning(startedAt);
	}

	markCompleted(result: string, completedAt?: number): void {
		this.state.markCompleted(result, completedAt);
	}

	markAborted(result: string, completedAt?: number): void {
		this.state.markAborted(result, completedAt);
	}

	markError(error: unknown, completedAt?: number): void {
		this.state.markError(error, completedAt);
	}

	markStopped(completedAt?: number): void {
		this.state.markStopped(completedAt);
	}

	markConsumed(at?: number): void {
		this.state.markConsumed(at);
	}

	claim(): CarrierClaim {
		return this.state.claim();
	}

	releaseClaims(): void {
		this.state.releaseClaims();
	}

	abort(): boolean {
		if (!this.isRunning()) return false;
		this.abortController.abort();
		this.markStopped();
		return true;
	}

	resetForResume(startedAt: number): void {
		this.state.resetForResume(startedAt);
		this.listeners.release();
	}

	completeRun(result: TurnLoopResult): void {
		this.listeners.release();

		const exhausted = result.turnBudget.phase === "exhausted";

		const finalStatus: SpawnStatus = this.isRunning() ? (exhausted ? "aborted" : "completed") : this.status;

		const holdForResume =
			finalStatus === "completed" &&
			this.pendingQuestion !== undefined &&
			!wrappedUpAtTurnLimit({ status: finalStatus, turnBudget: result.turnBudget });

		const finalResult = holdForResume
			? result.responseText
			: result.responseText + this.disposeWorkspaceFolded(finalStatus);

		if (exhausted) this.markAborted(finalResult);
		else this.markCompleted(finalResult);

		this.execution.observer?.onRunFinished?.(this);
	}

	async disposeSession(): Promise<void> {
		this.disposeHeldWorkspace();
		await disposeQuietly(this.spawnSession, "child session dispose");
	}

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

	failRun(err: unknown): void {
		this.markError(err);
		this.clearPendingQuestion();
		this.listeners.release();
		this.disposeWorkspaceQuietly("error");
		this.execution.observer?.onRunFinished?.(this);
	}

	private stoppedBeforeFirstTurn(resume = false): boolean {
		if (!this.abortController.signal.aborted) return false;
		this.listeners.release();
		void this.disposeSession();
		if (resume) this.execution.observer?.onResumeFinished?.(this);
		else this.execution.observer?.onRunFinished?.(this);
		return true;
	}

	private clearPendingQuestion(): void {
		this.state.setPendingQuestion(undefined);
	}

	private disposeHeldWorkspace(): void {
		if (this.isActive()) return;

		const notice = this.disposeWorkspaceQuietly(this.status);
		if (notice) this.execution.observer?.onWorkspaceNotice?.(this, notice);
	}

	private disposeWorkspaceQuietly(status: SpawnStatus): string {
		try {
			const notice = this.workspaceBracket.dispose({ status, description: this.description });
			if (notice) this.state.setWorkspaceNotice(notice);
			return notice;
		} catch (err) { debugLog(`workspace dispose (${status})`, err); return ""; }
	}

	private disposeWorkspaceFolded(status: SpawnStatus): string {
		try {
			return this.workspaceBracket.dispose({ status, description: this.description });
		} catch (err) { debugLog(`workspace dispose (${status})`, err); return ""; }
	}
}

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
