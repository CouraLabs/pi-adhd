export function isDebug(): boolean {
  return process.env.PI_SPAWN_DEBUG === "1";
}

export function debugLog(context: string, err: unknown): void {
  if (isDebug()) console.warn(`[pi-spawn:debug] ${context}:`, err);
}

export function debugNote(message: string): void {
  if (isDebug()) console.warn(`[pi-spawn:debug] ${message}`);
}
