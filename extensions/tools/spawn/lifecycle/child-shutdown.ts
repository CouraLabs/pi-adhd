import { debugLog } from "../debug.ts";

export const CHILD_SHUTDOWN_TIMEOUT_MS = 5_000;

const SESSION_SHUTDOWN = "session_shutdown";

interface ChildSessionShutdownEvent {
  type: typeof SESSION_SHUTDOWN;
  reason: "quit";
}

export interface ShutdownCapableSession {
  hasExtensionHandlers?(eventType: string): boolean;
  readonly extensionRunner?: {
    emit(event: ChildSessionShutdownEvent): Promise<unknown>;
  };
}

export async function emitChildSessionShutdown(
  session: ShutdownCapableSession,
  timeoutMs: number = CHILD_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const runner = session.extensionRunner;
  if (!runner || !hasShutdownHandlers(session)) return;

  try {
    const emitted = runner.emit({ type: SESSION_SHUTDOWN, reason: "quit" });
    if ((await settleWithinBound(emitted, timeoutMs)) === "timed-out") {
      debugLog("child session_shutdown exceeded its bound (ms)", timeoutMs);
    }
  } catch (err) {
    debugLog("child session_shutdown emit", err);
  }
}

function hasShutdownHandlers(session: ShutdownCapableSession): boolean {
  return session.hasExtensionHandlers?.(SESSION_SHUTDOWN) ?? true;
}

type ShutdownOutcome = "settled" | "timed-out";

async function settleWithinBound(
  emitted: Promise<unknown>,
  timeoutMs: number,
): Promise<ShutdownOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<ShutdownOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve("timed-out");
    }, timeoutMs);
  });
  const settled = emitted.then(
    (): ShutdownOutcome => "settled",
    (err: unknown): ShutdownOutcome => {
      debugLog("child session_shutdown handler", err);
      return "settled";
    },
  );

  try {
    return await Promise.race([settled, bound]);
  } finally {
    clearTimeout(timer);
  }
}
