/**
 * interlock — mutual exclusion between goal mode and the agent submodes.
 *
 * Goal mode and a submode (Plan/Grill) must not run together. A submode narrows
 * the active tool set to a read-only whitelist, which drops `goal`; goal mode
 * keeps its own saved tool list and restores it on exit, which re-widens the set
 * a submode had narrowed. Each feature asks this module before it starts.
 *
 * The goal flag lives on `globalThis`, keyed by a registered symbol, so every
 * pi-pack extension instance reads and writes the same value (see
 * `shared/store.ts`). The goal extension publishes it whenever the armed goal
 * changes.
 */

import { loadSettings } from "./settings.ts";
import { createGlobalStore } from "./store.ts";
import { SUBMODE_NAME, getSubmode, type Submode } from "./submodes.ts";

const store = createGlobalStore<boolean>(Symbol.for("couralabs.pi-pack:goal-active"), false);

/** Whether goal mode is armed: a goal exists and its accounting is live. */
export function isGoalActive(): boolean {
	return store.get();
}

/** Publish the armed state. No-op when unchanged. */
export function setGoalActive(active: boolean): void {
	store.set(active);
}

/**
 * The submode that is active or persisted. Reads the live store first, then the
 * stored setting: another extension's `session_start` handler may run before the
 * submodes extension restores the stored submode, so a guard cannot rely on the
 * store alone.
 */
function activeSubmode(): Submode {
	const live = getSubmode();
	return live === "none" ? loadSettings().submodes.current : live;
}

/** Whether a submode is active or persisted. */
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
