/**
 * service.ts — Public API surface for cross-extension access to spawn.
 *
 * Consumers declare this package as an optional peer dependency and use
 * dynamic import to access the accessor functions:
 *
 *   const { getSpawnService } = await import("@couralabs/pi-adhd/shared/spawn-service.ts");
 *   const svc = getSpawnService();
 *   svc?.listAgents();
 */

import type { ResumeRefusal, SpawnStatus } from "../lifecycle/spawn.ts";
import type { ResumeRefusalReason } from "../lifecycle/spawn-manager.ts";
import type { TurnBudget } from "../lifecycle/turn-limits.ts";
import type { LifetimeUsage } from "../lifecycle/usage.ts";
import type {
  Workspace,
  WorkspaceDisposeOutcome,
  WorkspaceDisposeResult,
  WorkspacePrepareContext,
  WorkspaceProvider,
} from "../lifecycle/workspace.ts";
import {
  getSpawnService as getSharedSpawnService,
  publishSpawnService as publishSharedSpawnService,
  unpublishSpawnService as unpublishSharedSpawnService,
} from "../../../../shared/spawn-service.ts";


// SpawnStatus is defined in the lifecycle layer (single home) and re-exported
// here for the public API surface — mirrors the LifetimeUsage / workspace pattern.
export type { SpawnStatus } from "../lifecycle/spawn.ts";
export type { TurnBudget, TurnBudgetPhase } from "../lifecycle/turn-limits.ts";
// The resume vocabulary is re-exported for the same reason: the record owns the
// reasons a resume is refused, and the manager adds the one that is not a fact
// about a record.
// Generative extension seam (ADR 0002, Phase 16 Step 2). The provider type
// and all four collaborator types it references are re-exported by name so
// consumers can import them directly rather than recovering them via
// indexed-access inference (e.g. `Parameters<WorkspaceProvider["prepare"]>[0]`).
export type {
  LifetimeUsage,
  ResumeRefusal,
  ResumeRefusalReason,
  Workspace,
  WorkspaceDisposeOutcome,
  WorkspaceDisposeResult,
  WorkspacePrepareContext,
  WorkspaceProvider,
};

/**
 * Serializable by-value snapshot of an agent's state.
 *
 * Produced by this package and read by consumers — not a contract third
 * parties implement, so a new field is a minor release. What earns a field a
 * place here (and what the snapshot deliberately withholds) is decided in
 * `docs/decisions/0005-spawn-record-admission-policy.md`.
 */
export interface SpawnRecord {
  id: string;
  type: string;
  description: string;
  status: SpawnStatus;
  result?: string;
  /** The question the agent ended its turn with, when it declared one. */
  pendingQuestion?: string;
  error?: string;
  toolUses: number;
  /**
   * The current run's turn budget: successful turns used, the ceiling (absent
   * when unlimited), and whether the harness has warned or stopped the run.
   * Live while the run is going; absent until its turn loop starts.
   */
  turnBudget?: TurnBudget;
  startedAt: number;
  completedAt?: number;
  lifetimeUsage: LifetimeUsage;
  compactionCount: number;
  /** Path to the agent's session JSONL, once the session exists. */
  outputFile?: string;
  /**
   * Why `resume()` would refuse this agent at snapshot time; absent when it
   * would start a run. `still-running` clears when the run settles; the other
   * reasons are final.
   */
  resumeRefusal?: ResumeRefusal;
}

/** Options for resuming an agent via the service. */
export interface ResumeOptions {
  /**
   * Declare that the caller will deliver the resumed outcome to the parent,
   * so nothing else announces it.
   */
  claimOutcome?: boolean;
  /**
   * Cancels the resumed turn loop. It is wired through the record's own lever,
   * so it ends the resume exactly as `abort(id)` does — the record reads
   * `stopped`, and either cancel reaches the same run.
   */
  signal?: AbortSignal;
}

/**
 * What a resume attempt produced.
 *
 * A resumed run that *failed* is still `resumed` — the snapshot carries
 * `status: "error"` and the message. `refused` means no turn loop ran.
 */
export type ResumeResult =
  | { kind: "resumed"; record: SpawnRecord }
  | { kind: "refused"; reason: ResumeRefusalReason };

/** The public service contract for cross-extension spawn access. */
export interface SpawnService {
  /** Get a snapshot of an agent's current state. */
  getRecord(id: string): SpawnRecord | undefined;

  /** List all tracked agents, most recent first. */
  listAgents(): SpawnRecord[];

  /** Abort a running agent. Returns false if not found. */
  abort(id: string): boolean;

  /**
   * Resume a settled agent with a new prompt, continuing its session.
   *
   * Resolves when the resumed run reaches a terminal state, carrying the
   * terminal snapshot — a caller that does not need the outcome can ignore the
   * promise. A refusal resolves promptly instead: the checks are synchronous
   * and no turn loop is started. A record's `resumeRefusal` answers the same
   * question before the call.
   */
  resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult>;

  /** Wait for all running agents to complete. */
  waitForAll(): Promise<void>;

  /** Whether any agents are running. */
  hasRunning(): boolean;

  /**
   * Register the single workspace provider that supplies a child's working
   * directory plus bracketed setup/teardown. Throws if one is already
   * registered. Returns a disposer that unregisters the provider.
   */
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
}

// ---- Accessor functions ----

/** Publish the SpawnService on globalThis for cross-extension access. */
export function publishSpawnService(service: SpawnService): void {
  publishSharedSpawnService(service);
}

/** Retrieve the published SpawnService, or undefined if not yet published. */
export function getSpawnService(): SpawnService | undefined {
  return getSharedSpawnService<SpawnService>();
}

/** Remove the SpawnService from globalThis (call on shutdown/reload). */
export function unpublishSpawnService(): void {
  unpublishSharedSpawnService();
}
