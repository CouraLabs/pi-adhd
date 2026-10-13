/**
 * interlock — mutual exclusion between goal mode and the agent submodes.
 *
 * Goal mode and a submode (Plan/Grill) must not run together. A submode narrows
 * the active tool set to a read-only whitelist, which drops `goal`; goal mode
 * keeps its own saved tool list and restores it on exit, which re-widens the set
 * a submode had narrowed. Each feature asks this module before it starts.
 *
 * The goal flag lives on `globalThis`, keyed by a registered symbol, so every
 * pi-adhd extension instance reads and writes the same value (see
 * `shared/store.ts`). The goal extension publishes it whenever the armed goal
 * changes.
 *
 * Both sides of the interlock are session-scoped: the submode store is restored
 * from the active session's branch (see `shared/submodes.ts`), and the goal flag
 * is published by the goal extension for the active session. Nothing is read
 * from the shared settings file, so a mode or goal in one pi instance can never
 * block a switch in another.
 */

import { isExtensionLoaded } from "./extension-registry.ts";
import { createGlobalStore } from "./store.ts";
import { SUBMODE_NAME, getSubmode, type Submode } from "./submodes.ts";

const store = createGlobalStore<boolean>(Symbol.for("@couralabs/pi-adhd/goal-active"), false);

/** Whether goal mode is armed: a goal exists and its accounting is live. */
export function isGoalActive(): boolean {
	return store.get();
}

/** Publish the armed state. No-op when unchanged. */
export function setGoalActive(active: boolean): void {
	store.set(active);
}

/**
 * The submode active in the current session. Reads the live store, which the
 * submodes extension restores from the session branch on `session_start`. The
 * barrel loads `submodes` before `goal`, so the restore publishes before the
 * goal handler consults it; a goal loaded without the submodes extension sees
 * `none`.
 */
function activeSubmode(): Submode {
	if (!isExtensionLoaded("submodes")) return "none";
	return getSubmode();
}

/** Whether a submode is active in the current session. */
export function submodeIsActive(): boolean {
	return activeSubmode() !== "none";
}

/** Message for a goal that refuses to start because a submode is active. */
export function goalBlockedBySubmodeMessage(): string {
	return `The ${SUBMODE_NAME[activeSubmode()]} submode is active. Exit the submode before starting a goal.`;
}

/** Message for a mode or submode switch that refuses because a goal is armed. */
export function switchBlockedByGoalMessage(): string {
	return "Goal mode is active. Complete or drop the goal before switching modes or submodes.";
}
