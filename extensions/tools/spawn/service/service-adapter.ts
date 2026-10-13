/**
 * service-adapter.ts — Adapter that wraps SpawnManager to satisfy SpawnService.
 *
 * Handles record serialization (stripping non-serializable fields).
 */

import type { ResumeCallOptions, ResumeOutcome } from "../lifecycle/spawn-manager.ts";
import type { WorkspaceProvider } from "../lifecycle/workspace.ts";
import type {
  ResumeOptions,
  ResumeResult,
  SpawnRecord,
  SpawnService,
} from "./service.ts";
import type { SessionContext, Spawn } from "../types.ts";

/** Narrow interface for the SpawnManager — avoids coupling to the concrete class. */
export interface SpawnManagerLike {
  getRecord(id: string): Spawn | undefined;
  listAgents(): Spawn[];
  abort(id: string): boolean;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
  resume(id: string, prompt: string, options: ResumeCallOptions): Promise<ResumeOutcome>;
}

/**
 * Narrow runtime interface consumed by the service adapter.
 * `SpawnRuntime` satisfies this structurally; tests use plain stubs.
 */
export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
}

/** Adapter that wraps SpawnManager to satisfy SpawnService. */
export class SpawnServiceAdapter implements SpawnService {
  constructor(private readonly manager: SpawnManagerLike) {}

  getRecord(id: string): SpawnRecord | undefined {
    const record = this.manager.getRecord(id);
    return record ? toSpawnRecord(record) : undefined;
  }

  listAgents(): SpawnRecord[] {
    return this.manager.listAgents().map(toSpawnRecord);
  }

  abort(id: string): boolean {
    return this.manager.abort(id);
  }

  async resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult> {
    const outcome = await this.manager.resume(id, prompt, {
      claimOutcome: options?.claimOutcome,
      signal: options?.signal,
    });
    // A refusal is the same value on both sides; only the resumed arm crosses
    // the by-value boundary the snapshot draws.
    return outcome.kind === "refused"
      ? outcome
      : { kind: "resumed", record: toSpawnRecord(outcome.record) };
  }

  async waitForAll(): Promise<void> {
    return this.manager.waitForAll();
  }

  hasRunning(): boolean {
    return this.manager.hasRunning();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    return this.manager.registerWorkspaceProvider(provider);
  }
}

/**
 * Convert an internal Spawn to a serializable SpawnRecord.
 *
 * The allowlist is explicit because the snapshot admits only discrete facts —
 * identity, resolved spawn decisions, cumulative metrics, and pointers to
 * durable artifacts. Live objects, momentary activity, and package-internal
 * bookkeeping stay out; see
 * `docs/decisions/0005-spawn-record-admission-policy.md`.
 */
export function toSpawnRecord(record: Spawn): SpawnRecord {
  const out: SpawnRecord = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    // Copy: the agent accumulates into its own object on every message_end, so
    // an aliased snapshot would drift, and a consumer could write into the
    // agent's totals.
    lifetimeUsage: { ...record.lifetimeUsage },
    compactionCount: record.compactionCount,
  };

  if (record.result !== undefined) out.result = record.result;
  if (record.pendingQuestion !== undefined) out.pendingQuestion = record.pendingQuestion;
  if (record.error !== undefined) out.error = record.error;
  if (record.completedAt !== undefined) out.completedAt = record.completedAt;
  // Copy, like lifetimeUsage: the snapshot is by value.
  if (record.turnBudget !== undefined) out.turnBudget = { ...record.turnBudget };
  if (record.outputFile !== undefined) out.outputFile = record.outputFile;
  if (record.resumeRefusal !== undefined) out.resumeRefusal = record.resumeRefusal;

  return out;
}
