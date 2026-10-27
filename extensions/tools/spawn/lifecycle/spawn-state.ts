import type { TurnBudget } from "./turn-limits.ts";
import type { LifetimeUsage } from "./usage.ts";
import { addUsage } from "./usage.ts";

export type SpawnStatus =
	| "running"
	| "completed"
	| "aborted"
	| "stopped"
	| "error";

export interface CarrierClaim {
	release(): void;
}

export function isActiveStatus(status: SpawnStatus): boolean {
	return status === "running";
}

export function isTerminalErrorStatus(status: SpawnStatus): boolean {
	return status === "error" || status === "stopped" || status === "aborted";
}

export function isRunningStatus(status: SpawnStatus): boolean {
	return status === "running";
}

export interface SpawnStateInit {
	status?: SpawnStatus;
	result?: string;

	pendingQuestion?: string;

	workspaceNotice?: string;

	turnBudget?: TurnBudget;
	error?: string;
	startedAt?: number;

	lastProgressAt?: number;
	completedAt?: number;

	consumedAt?: number;

	toolUses?: number;
	lifetimeUsage?: LifetimeUsage;
	compactionCount?: number;

	activeTools?: string[];
	responseText?: string;
}

export class SpawnState {

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

	private _consumedAt?: number;
	get consumedAt(): number | undefined { return this._consumedAt; }
	get consumed(): boolean { return this._consumedAt != null; }

	private readonly _claims = new Set<CarrierClaim>();
	get claimed(): boolean { return this._claims.size > 0; }

	private _run = 1;
	get run(): number { return this._run; }

	private _pendingQuestion?: string;
	get pendingQuestion(): string | undefined { return this._pendingQuestion; }

	private _workspaceNotice?: string;
	get workspaceNotice(): string | undefined { return this._workspaceNotice; }

	private _turnBudget?: TurnBudget;
	get turnBudget(): TurnBudget | undefined { return this._turnBudget; }

	private _toolUses: number;
	get toolUses(): number { return this._toolUses; }

	private _lifetimeUsage: LifetimeUsage;
	get lifetimeUsage(): Readonly<LifetimeUsage> { return this._lifetimeUsage; }

	private _compactionCount: number;
	get compactionCount(): number { return this._compactionCount; }

	private _activeTools = new Map<string, string>();
	get activeTools(): ReadonlyMap<string, string> { return this._activeTools; }

	private _toolKeySeq = 0;

	private _responseText: string;
	get responseText(): string { return this._responseText; }

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

	isActive(): boolean {
		return isActiveStatus(this._status);
	}

	isTerminalError(): boolean {
		return isTerminalErrorStatus(this._status);
	}

	isRunning(): boolean {
		return isRunningStatus(this._status);
	}

	incrementToolUses(): void {
		this._toolUses++;
	}

	addUsage(delta: { input: number; lastInput: number; output: number; lastOutput: number; cacheRead: number; lastCacheRead: number; cacheWrite: number; lastCacheWrite: number; cost: number }): void {
		addUsage(this._lifetimeUsage, delta);
	}

	incrementCompactions(): void {
		this._compactionCount++;
	}

	addActiveTool(toolName: string): void {
		this._activeTools.set(toolName + "_" + (++this._toolKeySeq), toolName);
	}

	removeActiveTool(toolName: string): void {
		for (const [key, name] of this._activeTools) {
			if (name === toolName) {
				this._activeTools.delete(key);
				break;
			}
		}
	}

	resetResponseText(): void {
		this._responseText = "";
	}

	appendResponseText(delta: string): void {
		this._responseText += delta;
	}

	markProgress(at: number = Date.now()): void {
		this._lastProgressAt = at;
	}

	markRunning(startedAt: number): void {
		this._status = "running";
		this._startedAt = startedAt;
		this._lastProgressAt = startedAt;
	}

	setTurnBudget(budget: TurnBudget): void {
		this._turnBudget = budget;
	}

	markCompleted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "completed";
		}
	}

	markAborted(result: string, completedAt?: number): void {
		this._result = result;
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "aborted";
		}
	}

	markError(error: unknown, completedAt?: number): void {
		this._error = error instanceof Error ? error.message : String(error);
		this._completedAt ??= completedAt ?? Date.now();
		if (this._status !== "stopped") {
			this._status = "error";
		}
	}

	markConsumed(at?: number): void {
		this._consumedAt ??= at ?? Date.now();
	}

	setPendingQuestion(question: string | undefined): void {
		this._pendingQuestion = question;
	}

	setWorkspaceNotice(notice: string): void {
		this._workspaceNotice = notice;
	}

	claim(): CarrierClaim {
		const claim: CarrierClaim = { release: () => { this._claims.delete(claim); } };
		this._claims.add(claim);
		return claim;
	}

	releaseClaims(): void {
		this._claims.clear();
	}

	markStopped(completedAt?: number): void {
		this._status = "stopped";
		this._completedAt = completedAt ?? Date.now();
	}

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

		this._activeTools.clear();

		this._pendingQuestion = undefined;
	}
}
