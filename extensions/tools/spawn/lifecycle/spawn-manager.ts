import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { debugLog } from "../debug.ts";
import type { CreateSpawnSessionParams } from "./create-spawn-session.ts";
import type { ParentSnapshot } from "./parent-snapshot.ts";
import { type ResumeRefusal, Spawn, type SpawnLifecycleObserver } from "./spawn.ts";
import type { SpawnSession } from "./spawn-session.ts";
import { SpawnState } from "./spawn-state.ts";
import type { WorkspaceProvider } from "./workspace.ts";

import type { RunConfig } from "../runtime.ts";
import type { AgentConfig, CompactionInfo, ParentSessionInfo, SpawnType, ThinkingLevel } from "../types.ts";

export interface SpawnTypeResolver {
  resolveType(name: string): string | undefined;
  isValidType(type: string): boolean;
  resolveAgentConfig(type: string): AgentConfig | undefined;
}

export type ResumeRefusalReason = ResumeRefusal | "unknown-agent";

export type ResumeOutcome =
  | { kind: "resumed"; record: Spawn }
  | { kind: "refused"; reason: ResumeRefusalReason };

export type ResumeStart =
  | { kind: "started"; record: Spawn }
  | { kind: "refused"; reason: ResumeRefusalReason };

export interface ResumeCallOptions {

  signal?: AbortSignal;

  claimOutcome?: boolean;
}

export interface RetentionPolicy {
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
}

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  consumedSessionRetentionMinutes: 10,
  unconsumedSessionRetentionMinutes: 720,
};

export interface RetentionCandidate {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
}

export interface RetentionWindow {
  referenceAt: number;
  windowMinutes: number;
}

export function resolveRetentionWindow(
  record: RetentionCandidate,
  policy: RetentionPolicy,
): RetentionWindow {
  if (record.consumed && record.pendingQuestion === undefined) {
    return {
      referenceAt: Math.max(record.completedAt ?? 0, record.consumedAt ?? 0),
      windowMinutes: policy.consumedSessionRetentionMinutes,
    };
  }
  return {
    referenceAt: record.completedAt ?? 0,
    windowMinutes: policy.unconsumedSessionRetentionMinutes,
  };
}

export interface SpawnManagerObserver {
  onSpawnStarted(record: Spawn): void;
  onSpawnCompleted(record: Spawn): void;

  onSpawnResuming(record: Spawn): void;

  onSpawnResumed(record: Spawn): void;

  onSpawnWorkspaceNotice?(record: Spawn, notice: string): void;
  onSpawnCompacted(record: Spawn, info: CompactionInfo): void;
}

export interface SpawnManagerOptions {

  createSpawnSession: (params: CreateSpawnSessionParams) => Promise<SpawnSession>;

  baseCwd: string;
  getRunConfig?: () => RunConfig;

  getRetentionPolicy?: () => RetentionPolicy;
  observer?: SpawnManagerObserver;

  registry: SpawnTypeResolver;
}

export interface AgentSpawnConfig {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;

  signal?: AbortSignal;

  observer?: SpawnLifecycleObserver;

  parentSession?: ParentSessionInfo;
}

export class SpawnManager {
  private agents = new Map<string, Spawn>();
  private sweepInterval: ReturnType<typeof setInterval>;
  private readonly observer?: SpawnManagerObserver;
  private readonly createSpawnSession: (params: CreateSpawnSessionParams) => Promise<SpawnSession>;
  private readonly baseCwd: string;
  private getRunConfig?: () => RunConfig;
  private getRetentionPolicy?: () => RetentionPolicy;
  private readonly registry: SpawnTypeResolver;
  private _workspaceProvider?: WorkspaceProvider;

  constructor(options: SpawnManagerOptions) {
    this.createSpawnSession = options.createSpawnSession;
    this.baseCwd = options.baseCwd;
    this.observer = options.observer;
    this.getRunConfig = options.getRunConfig;
    this.getRetentionPolicy = options.getRetentionPolicy;
    this.registry = options.registry;

    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    if (this._workspaceProvider) {
      throw new Error(
        "A WorkspaceProvider is already registered; only one is supported.",
      );
    }
    this._workspaceProvider = provider;
    return () => {
      if (this._workspaceProvider === provider) this._workspaceProvider = undefined;
    };
  }

  private buildObserver(options: AgentSpawnConfig): SpawnLifecycleObserver {
    return {
      onStarted: (agent) => {
        this.observer?.onSpawnStarted(agent);
      },
      onSessionCreated: options.observer?.onSessionCreated
        ? (agent) => options.observer!.onSessionCreated!(agent)
        : undefined,

      onRunFinished: (agent) => {
        try { this.observer?.onSpawnCompleted(agent); } catch (err) { debugLog("onSpawnCompleted observer", err); }
      },
      onResumeStarted: (agent) => {
        try { this.observer?.onSpawnResuming(agent); } catch (err) { debugLog("onSpawnResuming observer", err); }
      },
      onResumeFinished: (agent) => {
        try { this.observer?.onSpawnResumed(agent); } catch (err) { debugLog("onSpawnResumed observer", err); }
      },
      onWorkspaceNotice: (agent, notice) => {
        this.observer?.onSpawnWorkspaceNotice?.(agent, notice);
      },
      onCompacted: (agent, info) => {
        this.observer?.onSpawnCompacted(agent, info);
      },
    };
  }

  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SpawnType,
    prompt: string,
    options: AgentSpawnConfig,
  ): Promise<Spawn> {
    const id = this.create(snapshot, this.resolveSpawn(type), prompt, options);
    const record = this.agents.get(id)!;

    const claim = record.claim();
    try {
      await record.promise;
    } finally {
      claim.release();
    }
    return record;
  }

  private resolveSpawn(type: string): SpawnType {
    const canonical = this.registry.resolveType(type);
    if (canonical !== undefined && !this.registry.isValidType(canonical)) {
      throw new Error(`Agent type "${canonical}" is disabled`);
    }
    return canonical ?? "general-purpose";
  }

  private create(
    snapshot: ParentSnapshot,
    type: SpawnType,
    prompt: string,
    options: AgentSpawnConfig,
  ): string {
    const id = randomUUID().slice(0, 17);
    const record = new Spawn({
      id,
      type,
      description: options.description,
      state: new SpawnState({
        status: "running",
        startedAt: Date.now(),
      }),
      execution: {
        createSpawnSession: this.createSpawnSession,
        snapshot,
        prompt,
        baseCwd: this.baseCwd,
        observer: this.buildObserver(options),
        getRunConfig: this.getRunConfig,
        getWorkspaceProvider: () => this._workspaceProvider,
        model: options.model,
        maxTurns: options.maxTurns,
        thinkingLevel: options.thinkingLevel,
        parentSession: options.parentSession,
        signal: options.signal,
      },
    });
    this.agents.set(id, record);

    record.start();
    return id;
  }

  async resume(id: string, prompt: string, options: ResumeCallOptions = {}): Promise<ResumeOutcome> {
    const start = this.startResume(id, prompt, options);
    if (start.kind === "refused") return start;
    await start.record.promise;
    return { kind: "resumed", record: start.record };
  }

  startResume(id: string, prompt: string, options: ResumeCallOptions = {}): ResumeStart {
    const agent = this.agents.get(id);
    if (!agent) return { kind: "refused", reason: "unknown-agent" };
    const refusal = agent.resumeRefusal;
    if (refusal) return { kind: "refused", reason: refusal };

    if (options.claimOutcome) agent.claim();
    else agent.releaseClaims();

    void agent.resume(prompt, options.signal);
    return { kind: "started", record: agent };
  }

  getRecord(id: string): Spawn | undefined {
    return this.agents.get(id);
  }

  listAgents(): Spawn[] {
    return [...this.agents.values()].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
  }

  abort(id: string): boolean {
    const record = this.agents.get(id);
    if (!record) return false;
    return record.abort();
  }

  private removeRecord(id: string, record: Spawn): Promise<void> {
    this.agents.delete(id);
    return record.disposeSession();
  }

  private sweep() {
    const policy = this.getRetentionPolicy?.() ?? DEFAULT_RETENTION_POLICY;
    const now = Date.now();
    for (const record of this.agents.values()) {
      if (record.isActive()) continue;
      if (!record.isSessionReady()) continue;
      const { referenceAt, windowMinutes } = resolveRetentionWindow(record, policy);

      if (now - referenceAt >= windowMinutes * 60_000) void record.releaseSession();
    }
  }

  async clearCompleted(): Promise<void> {
    const teardowns: Promise<void>[] = [];
    for (const [id, record] of this.agents) {
      if (record.isActive()) continue;
      teardowns.push(this.removeRecord(id, record));
    }
    await Promise.all(teardowns);
  }

  hasRunning(): boolean {
    return [...this.agents.values()].some(r => r.isActive());
  }

  abortAll(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.abort()) {
        count++;
      }
    }
    return count;
  }

  async abortAllAndSettle(graceMs = 2000): Promise<number> {

    const pending = this.pendingPromises();
    const count = this.abortAll();
    if (pending.length === 0) return count;
    let settle: () => void = () => {};
    const graceElapsed = new Promise<void>((resolve) => { settle = resolve; });
    const timer = setTimeout(settle, graceMs);

    timer.unref?.();
    await Promise.race([Promise.allSettled(pending), graceElapsed]);
    return count;
  }

  async waitForAll(): Promise<void> {

    let pending = this.pendingPromises();
    while (pending.length > 0) {
      await Promise.allSettled(pending);
      pending = this.pendingPromises();
    }
  }

  private pendingPromises(): Promise<void>[] {
    return [...this.agents.values()]
      .filter(r => r.isActive())
      .map(r => r.promise)
      .filter((p): p is Promise<void> => p != null);
  }

  async dispose(): Promise<void> {
    clearInterval(this.sweepInterval);
    const teardowns = [...this.agents.values()].map(record => record.disposeSession());
    this.agents.clear();
    await Promise.allSettled(teardowns);
  }
}
