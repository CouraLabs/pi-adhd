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

export type { SpawnStatus } from "../lifecycle/spawn.ts";
export type { TurnBudget, TurnBudgetPhase } from "../lifecycle/turn-limits.ts";

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

export interface SpawnRecord {
  id: string;
  type: string;
  description: string;
  status: SpawnStatus;
  result?: string;

  pendingQuestion?: string;
  error?: string;
  toolUses: number;

  turnBudget?: TurnBudget;
  startedAt: number;
  completedAt?: number;
  lifetimeUsage: LifetimeUsage;
  compactionCount: number;

  outputFile?: string;

  resumeRefusal?: ResumeRefusal;
}

export interface ResumeOptions {

  claimOutcome?: boolean;

  signal?: AbortSignal;
}

export type ResumeResult =
  | { kind: "resumed"; record: SpawnRecord }
  | { kind: "refused"; reason: ResumeRefusalReason };

export interface SpawnService {

  getRecord(id: string): SpawnRecord | undefined;

  listAgents(): SpawnRecord[];

  abort(id: string): boolean;

  resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult>;

  waitForAll(): Promise<void>;

  hasRunning(): boolean;

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
}

export function publishSpawnService(service: SpawnService): void {
  publishSharedSpawnService(service);
}

export function getSpawnService(): SpawnService | undefined {
  return getSharedSpawnService<SpawnService>();
}

export function unpublishSpawnService(): void {
  unpublishSharedSpawnService();
}
