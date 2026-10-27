import {
  buildParentSnapshot,
  type ParentPromptOptions,
  type ParentSnapshot,
} from "./lifecycle/parent-snapshot.ts";
import type { ModelInfo } from "./tools/spawn-config.ts";
import type { SessionContext } from "./types.ts";

export interface RunConfig {
  readonly defaultMaxTurns: number | undefined;
  readonly wrapUpTurns: number;
}

export class SpawnRuntime {

  currentCtx: SessionContext | undefined = undefined;

  private lastPromptOptions: ParentPromptOptions | undefined = undefined;

  setSessionContext(ctx: SessionContext): void {
    this.currentCtx = ctx;
  }

  clearSessionContext(): void {
    this.currentCtx = undefined;
  }

  setSystemPromptOptions(options: ParentPromptOptions): void {
    this.lastPromptOptions = options;
  }

  buildSnapshot(inheritContext: boolean): ParentSnapshot {

    return buildParentSnapshot(this.currentCtx!, inheritContext, this.lastPromptOptions);
  }

  getModelInfo(): ModelInfo {
    return {
      parentModel: this.currentCtx?.model,
      modelRegistry: this.currentCtx?.modelRegistry,
    };
  }

  getSessionInfo(): { parentSessionFile: string; parentSessionId: string } {
    return {
      parentSessionFile: this.currentCtx?.sessionManager.getSessionFile() ?? "",
      parentSessionId: this.currentCtx?.sessionManager.getSessionId() ?? "",
    };
  }
}

export function createSpawnRuntime(): SpawnRuntime {
  return new SpawnRuntime();
}
