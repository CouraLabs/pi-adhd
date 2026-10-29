// src/lib/format.ts
// Pure display formatting helpers (client-side UI concern only).

/**
 * Format a token count in a compact, chat-app style:
 * - 0..999       -> exact ("0", "123")
 * - 1.0k..999.9k -> one-decimal thousands ("1.2k", "999.9k")
 * - >= 1M        -> one-decimal millions ("1.0M", "12.3M")
 */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Format a duration in milliseconds:
 * - < 60s  -> "Ns"
 * - < 60m  -> "Nm Ns"
 * - >= 60m -> "Nh Nm"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
