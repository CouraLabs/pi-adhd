import type { SpawnStatus } from "./spawn.ts";
import type { SpawnType } from "../types.ts";

export interface WorkspacePrepareContext {
  agentId: string;
  agentType: SpawnType;
  baseCwd: string;
}

export interface WorkspaceDisposeOutcome {
  status: SpawnStatus;
  description: string;
}

export interface WorkspaceDisposeResult {

  resultAddendum?: string;
}

export interface Workspace {

  readonly cwd: string;
  dispose(outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | undefined;
}

export interface WorkspaceProvider {
  prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined>;
}
