import type { TurnBudget } from "./turn-limits.ts";

export const SPAWN_CHILD_SPAWNING = "spawn:child:spawning";

export const SPAWN_CHILD_SESSION_CREATED = "spawn:child:session-created";

export const SPAWN_CHILD_BOUND = "spawn:child:bound";

export const SPAWN_CHILD_COMPLETED = "spawn:child:completed";

export const SPAWN_CHILD_DISPOSED = "spawn:child:disposed";

export interface ChildSpawningEvent {
  agentName: string;
  parentSessionId?: string;
}

export interface ChildSessionCreatedEvent {

  sessionId: string;
  parentSessionId?: string;
}

export interface ChildBoundEvent {

  sessionId: string;
  parentSessionId?: string;
}

export interface ChildCompletedEvent {
  sessionDir: string;
  agentName: string;

  turnBudget?: TurnBudget;
}

export interface ChildDisposedEvent {

  sessionId: string;
}

export type LifecycleEmit = (channel: string, data: unknown) => void;

export interface ChildLifecyclePublisher {
  spawning(event: ChildSpawningEvent): void;
  sessionCreated(event: ChildSessionCreatedEvent): void;
  bound(event: ChildBoundEvent): void;
  completed(event: ChildCompletedEvent): void;
  disposed(event: ChildDisposedEvent): void;
}

export function createChildLifecyclePublisher(
  emit: LifecycleEmit,
): ChildLifecyclePublisher {
  return {
    spawning(event) {
      emit(SPAWN_CHILD_SPAWNING, event);
    },
    sessionCreated(event) {
      emit(SPAWN_CHILD_SESSION_CREATED, event);
    },
    bound(event) {
      emit(SPAWN_CHILD_BOUND, event);
    },
    completed(event) {
      emit(SPAWN_CHILD_COMPLETED, event);
    },
    disposed(event) {
      emit(SPAWN_CHILD_DISPOSED, event);
    },
  };
}
