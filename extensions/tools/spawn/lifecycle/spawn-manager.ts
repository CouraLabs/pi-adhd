/**
 * spawn-manager.ts - Tracks spawn and resume support.
 *
 * All agents run foreground: the caller holds the result promise and blocks
 * until the run settles.
 */

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

/**
 * The agent-registry slice the manager needs to resolve a spawn. Deliberately
 * narrower than AgentConfigLookup, whose slice serves session assembly (ISP).
 */
export interface SpawnTypeResolver {
  resolveType(name: string): string | undefined;
  isValidType(type: string): boolean;
  resolveAgentConfig(type: string): AgentConfig;
}

/**
 * Why a resume was refused, across every front door.
 *
 * Widens the record's own vocabulary by the one refusal that is not a fact
 * about a record: an id no record answers to.
 */
export type ResumeRefusalReason = ResumeRefusal | "unknown-agent";

/**
 * What a resume attempt produced: the record whose run was restarted, or the
 * reason nothing was started.
 *
 * A resumed run that *failed* is still `resumed` — the record carries the
 * error. `refused` means the turn loop never ran.
 */
export type ResumeOutcome =
  | { kind: "resumed"; record: Spawn }
  | { kind: "refused"; reason: ResumeRefusalReason };

/**
 * What starting a resume produced: the record now running it, or the reason
 * nothing was started.
 *
 * The run itself continues on the record; its `promise` settles when the
 * resumed run reaches a terminal state.
 */
export type ResumeStart =
  | { kind: "started"; record: Spawn }
  | { kind: "refused"; reason: ResumeRefusalReason };

/** Per-call knobs for a resume; both doors pass their own. */
export interface ResumeCallOptions {
  /** Cancels the resumed turn loop, through the record's own lever — so it ends like `abort(id)` does. */
  signal?: AbortSignal;
  /**
   * The caller will deliver this outcome to the parent, so nothing announces
   * it. Omitted, the resumed outcome is announced like any other completion.
   */
  claimOutcome?: boolean;
}

/**
 * Session-retention windows (minutes). `SettingsManager` satisfies this
 * structurally; a live getter (`getRetentionPolicy`) lets the sweep read the
 * current values without a construction-time settings dependency.
 */
export interface RetentionPolicy {
  readonly consumedSessionRetentionMinutes: number;
  readonly unconsumedSessionRetentionMinutes: number;
}

const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  consumedSessionRetentionMinutes: 10,
  unconsumedSessionRetentionMinutes: 720,
};

/**
 * Only what the retention rule reads. Narrower than `Spawn` so the rule
 * stays a plain function over four facts, testable without spawning an agent.
 */
export interface RetentionCandidate {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
}

/** When a terminal record's session-release window opened, and how long it runs. */
export interface RetentionWindow {
  referenceAt: number;
  windowMinutes: number;
}

/**
 * Pick the retention window for one terminal record.
 *
 * A collected outcome releases on the short window, measured from the later of
 * completion and collection, so a late read still gets a full resume window; an
 * uncollected one holds until the long safety cap.
 *
 * A record carrying an unanswered question is not collected, whatever
 * `consumed` says: the parent has read the question but has not answered it,
 * and the answer is delivered by resuming the very session the short window
 * would release.
 */
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

/** Observer interface for agent lifecycle notifications. */
export interface SpawnManagerObserver {
  onSpawnStarted(record: Spawn): void;
  onSpawnCompleted(record: Spawn): void;
  /**
   * Fires when a resume starts, from whichever front door asked for it.
   * Required: a consumer that tracks the live set has to learn that a
   * settled record went back to running, and the only alternative is polling.
   */
  onSpawnResuming(record: Spawn): void;
  /** Fires when a resumed run reaches a terminal state (distinct from a fresh completion). */
  onSpawnResumed(record: Spawn): void;
  /**
   * Fires when a teardown after the record's result was delivered reported
   * where its work went.
   * Optional: a hook nobody supplies is a vacant one.
   */
  onSpawnWorkspaceNotice?(record: Spawn, notice: string): void;
  onSpawnCompacted(record: Spawn, info: CompactionInfo): void;
}

export interface SpawnManagerOptions {
  /** Assembly factory that produces a born-complete SpawnSession per spawn. */
  createSpawnSession: (params: CreateSpawnSessionParams) => Promise<SpawnSession>;
  /** Base working directory handed to a workspace provider (the parent cwd). */
  baseCwd: string;
  getRunConfig?: () => RunConfig;
  /** Live accessor for the session-retention windows; defaults applied when absent. */
  getRetentionPolicy?: () => RetentionPolicy;
  observer?: SpawnManagerObserver;
  /** Agent registry, consulted to canonicalize a spawn's type and resolve its config. */
  registry: SpawnTypeResolver;
}

export interface AgentSpawnConfig {
  description: string;
  model?: Model<any>;
  maxTurns?: number;
  inheritContext?: boolean;
  thinkingLevel?: ThinkingLevel;
  /** Parent abort signal - when aborted, the spawn is also stopped. */
  signal?: AbortSignal;
  /** Per-spawn lifecycle observer — replaces onSessionCreated callback. */
  observer?: SpawnLifecycleObserver;
  /** Parent session identity - grouped fields that travel together from the tool boundary. */
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
    // Periodically release the heavy session of terminal agents past their
    // retention window. The lightweight record (with its result) is kept for the
    // session lifetime, so a late resume is still refused with a reason rather
    // than lost.
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref();
  }

  /**
   * Register the single workspace provider. Throws if one is already
   * registered (chaining is out of scope — see ADR 0002). Returns a disposer
   * that clears the slot only if this provider is still the active one.
   */
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

  /** Compose a per-agent lifecycle observer from manager and spawn-config concerns. */
  private buildObserver(options: AgentSpawnConfig): SpawnLifecycleObserver {
    return {
      onStarted: (agent) => {
        this.observer?.onSpawnStarted(agent);
      },
      onSessionCreated: options.observer?.onSessionCreated
        ? (agent) => options.observer!.onSessionCreated!(agent)
        : undefined,
      // Terminal transitions are reported for every agent. Whether the parent
      // needs telling is the notification layer's decision, made from the
      // carrier claim; suppressing the observer here would also suppress the
      // lifecycle event and the session-history record, which are facts about
      // the run rather than announcements.
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

  /**
   * Spawn an agent and wait for completion (foreground use).
   *
   * The caller holds the result, which is a delivery commitment: the agent must
   * not be announced, whatever its frontmatter declares.
   *
   * Rejects when the named agent type is disabled.
   */
  async spawnAndWait(
    snapshot: ParentSnapshot,
    type: SpawnType,
    prompt: string,
    options: AgentSpawnConfig,
  ): Promise<Spawn> {
    const id = this.create(snapshot, this.resolveSpawn(type), prompt, options);
    const record = this.agents.get(id)!;
    // The caller holds the result, so this call is the carrier: claim the outcome
    // before awaiting it, so nothing announces what is already being delivered.
    record.claim();
    await record.promise;
    return record;
  }

  /**
   * Stamp the invariants every front door shares: a canonical agent type and a
   * rejection for a disabled one.
   */
  private resolveSpawn(type: string): SpawnType {
    const canonical = this.registry.resolveType(type);
    if (canonical !== undefined && !this.registry.isValidType(canonical)) {
      throw new Error(`Agent type "${canonical}" is disabled`);
    }
    return canonical ?? "general-purpose";
  }

  /** Create, register, and start a record for an already-resolved spawn. */
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

  /**
   * Resume an existing agent session with a new prompt.
   *
   * The refusal policy lives here rather than in a caller, so every front door
   * declines the same resumes for the same reasons; a door owns only how it
   * words the answer. Delegates to Spawn.resume(), which owns the observer
   * subscription lifecycle.
   */
  async resume(id: string, prompt: string, options: ResumeCallOptions = {}): Promise<ResumeOutcome> {
    const start = this.startResume(id, prompt, options);
    if (start.kind === "refused") return start;
    await start.record.promise;
    return { kind: "resumed", record: start.record };
  }

  /**
   * Start a resume without waiting for it: the door that returns before the
   * resumed run ends. Refuses synchronously, for the same reasons `resume` does.
   */
  startResume(id: string, prompt: string, options: ResumeCallOptions = {}): ResumeStart {
    const agent = this.agents.get(id);
    if (!agent) return { kind: "refused", reason: "unknown-agent" };
    const refusal = agent.resumeRefusal;
    if (refusal) return { kind: "refused", reason: refusal };
    // Before the resume starts: resetForResume runs synchronously inside
    // resume(), so a claim taken afterwards would miss the terminal edge.
    // Each resume's caller decides who carries this run's outcome; a claim a
    // previous carrier left behind belongs to an outcome already delivered, and
    // no carrier is live on a settled record.
    if (options.claimOutcome) agent.claim();
    else agent.releaseClaims();
    // Published as agent.promise, which always resolves; it rejects only for a
    // missing session, which resumeRefusal has already refused as no-session.
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

  /**
   * Remove a record from the map and tear its session down.
   * The map is updated first so the record is unreachable while its child's
   * extensions shut down.
   */
  private removeRecord(id: string, record: Spawn): Promise<void> {
    this.agents.delete(id);
    return record.disposeSession();
  }

  /**
   * Release the heavy session of any terminal agent past its retention window.
   * The record (with its result) is retained for the session lifetime; only the
   * live `AgentSession` is freed. `resolveRetentionWindow` owns which window
   * applies.
   */
  private sweep() {
    const policy = this.getRetentionPolicy?.() ?? DEFAULT_RETENTION_POLICY;
    const now = Date.now();
    for (const record of this.agents.values()) {
      if (record.isActive()) continue;
      if (!record.isSessionReady()) continue; // already released, or never had a session
      const { referenceAt, windowMinutes } = resolveRetentionWindow(record, policy);
      // Fire-and-forget: the sweep runs on an interval with no one to await it,
      // and Spawn.releaseSession() already swallows a failing teardown.
      if (now - referenceAt >= windowMinutes * 60_000) void record.releaseSession();
    }
  }

  /**
   * Remove all completed/stopped/errored records immediately.
   * Called on session start/switch so tasks from a prior session don't persist.
   */
  async clearCompleted(): Promise<void> {
    const teardowns: Promise<void>[] = [];
    for (const [id, record] of this.agents) {
      if (record.isActive()) continue;
      teardowns.push(this.removeRecord(id, record));
    }
    await Promise.all(teardowns);
  }

  /** Whether any agents are still running. */
  // fallow-ignore-next-line unused-class-member
  hasRunning(): boolean {
    return [...this.agents.values()].some(r => r.isActive());
  }

  /** Abort all running agents immediately. */
  abortAll(): number {
    let count = 0;
    for (const record of this.agents.values()) {
      if (record.abort()) {
        count++;
      }
    }
    return count;
  }

  /** Wait for all running agents to complete. */
  // fallow-ignore-next-line unused-class-member
  async waitForAll(): Promise<void> {
    // The loop only catches agents spawned during the wait.
    let pending = this.pendingPromises();
    while (pending.length > 0) {
      await Promise.allSettled(pending);
      pending = this.pendingPromises();
    }
  }

  /** Promises of all running agents that have one. */
  private pendingPromises(): Promise<void>[] {
    return [...this.agents.values()]
      .filter(r => r.isActive())
      .map(r => r.promise)
      .filter((p): p is Promise<void> => p != null);
  }

  /**
   * Tear down every record, resolving once each child's extensions have shut
   * down. The registry is emptied before the teardowns are awaited, so nothing
   * can reach a dying record; `allSettled` keeps one failing child from
   * abandoning its siblings.
   */
  async dispose(): Promise<void> {
    clearInterval(this.sweepInterval);
    const teardowns = [...this.agents.values()].map(record => record.disposeSession());
    this.agents.clear();
    await Promise.allSettled(teardowns);
  }
}
