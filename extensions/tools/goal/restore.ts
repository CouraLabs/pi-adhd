/**
 * pi-goal — session persistence helpers.
 *
 * omp persisted goal state through host mode-change entries
 * (sessionManager.appendModeChange("goal" | "goal_paused" | "none", { goal })).
 * pi has no mode-change entries, so the host persist callback writes explicit
 * full-snapshot custom entries instead:
 *
 *   persist("goal", state)        → appendEntry("goal-state", { enabled: true,  goal })
 *   persist("goal_paused", state) → appendEntry("goal-state", { enabled: false, goal })
 *   persist("none")               → appendEntry("goal-cleared", { droppedBy })
 *
 * Restore scans the CURRENT BRANCH backward: the latest `goal-cleared` wins if
 * it is newer than the latest `goal-state`; otherwise the latest valid
 * `goal-state` snapshot applies. Branch awareness comes for free because
 * appendEntry chains off the current leaf. Malformed entries are skipped so a
 * corrupt entry can never break startup.
 */

import { cloneGoal, type GoalModeState, isGoalStateSnapshot } from "./state.ts";

/** Session entry customType for goal state snapshots (see pi.appendEntry). */
export const GOAL_STATE_ENTRY_TYPE = "goal-state";

/** Session entry customType written when a goal is dropped (omp mode "none"). */
export const GOAL_CLEARED_ENTRY_TYPE = "goal-cleared";

/** Session entry customType for the completion summary (omp "goal-completed"). */
export const GOAL_COMPLETED_ENTRY_TYPE = "goal-completed";

interface EntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

export interface RestoredGoal {
	state: GoalModeState;
	/** Branch position the snapshot came from (ordering anchor vs goal-cleared). */
	entryIndex: number;
}

export interface RestoredCleared {
	entryIndex: number;
}

/**
 * Latest valid `goal-state` snapshot reachable on the current branch, or
 * undefined when none exists.
 */
export function latestGoalStateEntry(entries: readonly unknown[]): RestoredGoal | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as EntryLike | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== GOAL_STATE_ENTRY_TYPE) continue;
		if (isGoalStateSnapshot(entry.data)) {
			return {
				state: { enabled: entry.data.enabled, mode: "active", goal: cloneGoal(entry.data.goal) },
				entryIndex: i,
			};
		}
	}
	return undefined;
}

/** Latest `goal-cleared` marker reachable on the current branch, or undefined. */
export function latestGoalClearedEntry(entries: readonly unknown[]): RestoredCleared | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as EntryLike | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== GOAL_CLEARED_ENTRY_TYPE) continue;
		return { entryIndex: i };
	}
	return undefined;
}

/**
 * Restore goal state from session entries: a cleared marker newer than the
 * latest snapshot means no goal; otherwise the snapshot applies. Both scans
 * already run backward over the branch, so the comparison is by the position
 * each scan stopped at — no dependency on entry ids, which a hand-built or
 * legacy branch may omit.
 */
export function restoreGoalFromEntries(entries: readonly unknown[]): GoalModeState | undefined {
	const cleared = latestGoalClearedEntry(entries);
	const state = latestGoalStateEntry(entries);
	if (!state) return undefined;
	if (cleared && cleared.entryIndex > state.entryIndex) return undefined;
	return state.state;
}
