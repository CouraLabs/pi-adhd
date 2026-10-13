/**
 * thinking/durations — persistence for completed reasoning runs.
 *
 * A run's elapsed time is measured live and then written as a custom session
 * entry so resumed sessions can show `Thought for 3s` without re-deriving it.
 * Entries are validated on restore because the session file is user-editable
 * and may predate the current shape.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { DurationEntryData } from "./types.ts";

export const DURATION_ENTRY_TYPE = "compact-thinking-duration";

/** Rebuild the per-message duration map from a branch's custom entries. */
export function restoreDurationEntries(
	entries: readonly SessionEntry[],
	completedDurations: Map<number, Map<number, number>>,
): void {
	completedDurations.clear();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== DURATION_ENTRY_TYPE) continue;
		if (!entry.data || typeof entry.data !== "object") continue;

		const data = entry.data as Partial<DurationEntryData>;
		if (
			typeof data.messageTimestamp !== "number" ||
			!Number.isFinite(data.messageTimestamp) ||
			typeof data.contentIndex !== "number" ||
			!Number.isInteger(data.contentIndex) ||
			typeof data.durationMs !== "number" ||
			!Number.isFinite(data.durationMs) ||
			data.durationMs < 1
		) {
			continue;
		}

		let durations = completedDurations.get(data.messageTimestamp);
		if (!durations) {
			durations = new Map();
			completedDurations.set(data.messageTimestamp, durations);
		}
		durations.set(data.contentIndex, data.durationMs);
	}
}
