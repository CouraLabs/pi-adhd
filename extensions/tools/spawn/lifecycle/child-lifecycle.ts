/**
 * child-lifecycle.ts — Child-execution lifecycle event contract and publisher.
 *
 * The core publishes its child-execution lifecycle as ordered events on the Pi
 * event bus; reactive consumers (permissions, telemetry, UI) subscribe rather
 * than the core reaching out to them (ADR 0002). This module owns the channel
 * names, payload shapes, and the publisher that emits them.
 *
 * The publisher takes an injected `emit` callback so this module stays free of
 * Pi SDK imports — `index.ts` wires it to `pi.events.emit`.
 *
 * `spawning`, `session-created`, `completed`, and `disposed` are the announcement
 * a consumer may rely on. `bound` is additional: it reports that a child finished
 * binding its extensions, which is the only moment a parent can observe what those
 * extensions did or did not install.
 */

import type { TurnBudget } from "./turn-limits.ts";

/** Emitted at the start of a child run, before the session is created. */
export const SPAWN_CHILD_SPAWNING = "spawn:child:spawning";

/**
 * Emitted after the child session is created, immediately before
 * `bindExtensions()`. Carries the child session id consumers need to register
 * the session in `SpawnSessionRegistry`. Subscribers must register
 * synchronously so the entry lands before binding proceeds (see ADR 0002 /
 * the event-bus synchronous-dispatch guarantee).
 */
export const SPAWN_CHILD_SESSION_CREATED = "spawn:child:session-created";

/**
 * Emitted once the child's extensions have bound, after every child
 * `session_start` handler has run and before the child takes its first turn.
 *
 * Skipped when binding throws: that child never runs, so there is nothing to
 * report about it.
 */
export const SPAWN_CHILD_BOUND = "spawn:child:bound";

/** Emitted after the child's prompt resolves, whether it finished or the harness stopped it. */
export const SPAWN_CHILD_COMPLETED = "spawn:child:completed";

/** Emitted in the run's `finally` — always fires, on success and error. */
export const SPAWN_CHILD_DISPOSED = "spawn:child:disposed";

/** Payload for `spawn:child:spawning`. */
export interface ChildSpawningEvent {
  agentName: string;
  parentSessionId?: string;
}

/** Payload for `spawn:child:session-created`. */
export interface ChildSessionCreatedEvent {
  /** Child session id — the registry key. Unique per child; concurrent
   * siblings of the same parent occupy distinct keys. */
  sessionId: string;
  parentSessionId?: string;
}

/** Payload for `spawn:child:bound`. */
export interface ChildBoundEvent {
  /** Child session id — the same key `session-created` carried. */
  sessionId: string;
  parentSessionId?: string;
}

/** Payload for `spawn:child:completed`. */
export interface ChildCompletedEvent {
  sessionDir: string;
  agentName: string;
  /** The run's turn limit and its use; absent when no limit applied. */
  turnBudget?: TurnBudget;
}

/** Payload for `spawn:child:disposed`. */
export interface ChildDisposedEvent {
  /** Child session id — the registry key. Must match `session-created`. */
  sessionId: string;
}

/** Narrow emit seam — injected, never imports the Pi SDK. */
export type LifecycleEmit = (channel: string, data: unknown) => void;

/** Publishes the child-execution lifecycle on the event bus. */
export interface ChildLifecyclePublisher {
  spawning(event: ChildSpawningEvent): void;
  sessionCreated(event: ChildSessionCreatedEvent): void;
  bound(event: ChildBoundEvent): void;
  completed(event: ChildCompletedEvent): void;
  disposed(event: ChildDisposedEvent): void;
}

/** Build a publisher backed by an injected `emit` callback. */
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
