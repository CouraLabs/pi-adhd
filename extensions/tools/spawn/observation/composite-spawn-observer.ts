import { debugLog } from "../debug.ts";
import type { SpawnManagerObserver } from "../lifecycle/spawn-manager.ts";
import type { CompactionInfo, Spawn } from "../types.ts";

export class CompositeSpawnObserver implements SpawnManagerObserver {
  private readonly delegates: SpawnManagerObserver[];

  constructor(delegates: SpawnManagerObserver[]) {
    this.delegates = [...delegates];
  }

  add(observer: SpawnManagerObserver): void {
    this.delegates.push(observer);
  }

  onSpawnStarted(record: Spawn): void {
    this.dispatch((o) => o.onSpawnStarted(record), "onSpawnStarted");
  }

  onSpawnCompleted(record: Spawn): void {
    this.dispatch((o) => o.onSpawnCompleted(record), "onSpawnCompleted");
  }

  onSpawnResuming(record: Spawn): void {
    this.dispatch((o) => o.onSpawnResuming(record), "onSpawnResuming");
  }

  onSpawnResumed(record: Spawn): void {
    this.dispatch((o) => o.onSpawnResumed(record), "onSpawnResumed");
  }

  onSpawnWorkspaceNotice(record: Spawn, notice: string): void {
    this.dispatch(
      (o) => o.onSpawnWorkspaceNotice?.(record, notice),
      "onSpawnWorkspaceNotice",
    );
  }

  onSpawnCompacted(record: Spawn, info: CompactionInfo): void {
    this.dispatch((o) => o.onSpawnCompacted(record, info), "onSpawnCompacted");
  }

  private dispatch(call: (o: SpawnManagerObserver) => void, label: string): void {
    for (const o of this.delegates) {
      try {
        call(o);
      } catch (err) {
        debugLog(`CompositeSpawnObserver.${label}`, err);
      }
    }
  }
}
