import type { ResumeCallOptions, ResumeOutcome } from "../lifecycle/spawn-manager.ts";
import type { WorkspaceProvider } from "../lifecycle/workspace.ts";
import type {
  ResumeOptions,
  ResumeResult,
  SpawnRecord,
  SpawnService,
} from "./service.ts";
import type { SessionContext, Spawn } from "../types.ts";

export interface SpawnManagerLike {
  getRecord(id: string): Spawn | undefined;
  listAgents(): Spawn[];
  abort(id: string): boolean;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
  resume(id: string, prompt: string, options: ResumeCallOptions): Promise<ResumeOutcome>;
}

export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
}

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

export function toSpawnRecord(record: Spawn): SpawnRecord {
  const out: SpawnRecord = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    toolUses: record.toolUses,
    startedAt: record.startedAt,

    lifetimeUsage: { ...record.lifetimeUsage },
    compactionCount: record.compactionCount,
  };

  if (record.result !== undefined) out.result = record.result;
  if (record.pendingQuestion !== undefined) out.pendingQuestion = record.pendingQuestion;
  if (record.error !== undefined) out.error = record.error;
  if (record.completedAt !== undefined) out.completedAt = record.completedAt;

  if (record.turnBudget !== undefined) out.turnBudget = { ...record.turnBudget };
  if (record.outputFile !== undefined) out.outputFile = record.outputFile;
  if (record.resumeRefusal !== undefined) out.resumeRefusal = record.resumeRefusal;

  return out;
}
