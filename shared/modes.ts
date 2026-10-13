/**
 * modes — shared agent-mode state for pi-tdah.
 *
 * pi-tdah has two agent modes:
 *
 *   - `"work"` (default): replaces pi's default system prompt with the
 *     pi-tdah Work rules and makes the agent orchestrate via spawned agents.
 *   - `"pi"`: leaves pi's default system prompt untouched.
 *
 * The state lives on `globalThis`, keyed by a registered symbol, so every
 * pi-tdah extension — the `modes` extension that owns the toggle, the
 * `footer` that draws the label, and the `editor` that colors its border —
 * reads and mutates the same value even when their modules are loaded twice.
 * Extensions subscribe to re-render when the mode changes.
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { MODE_PI, MODE_WORK } from "./glyphs.ts";
import { createGlobalStore } from "./store.ts";

/** The two agent modes. */
export type AgentMode = "pi" | "work";

/** The mode a fresh install starts in. */
export const DEFAULT_AGENT_MODE: AgentMode = "work";

/** Human-readable mode name shown in the footer, glyph included. */
export const AGENT_MODE_LABEL: Record<AgentMode, string> = {
	pi: `${MODE_PI} Pi`,
	work: `${MODE_WORK} Work`,
};

/** One-sentence explanation of what a mode does, shown when it becomes active. */
export const MODE_NOTICE: Record<AgentMode, string> = {
	pi: `${AGENT_MODE_LABEL.pi}. pi's default system prompt is in effect — no pi-tdah rules are added, so the agent answers in its own voice with pi's built-in guidance and the full toolset.`,
	work: `${AGENT_MODE_LABEL.work}. The pi-tdah Work rules replace the default system prompt: the agent orchestrates, delegating exploration and implementation to spawned agents, asks before assuming, and tracks progress with the todo tool.`,
};

const store = createGlobalStore<AgentMode>(Symbol.for("@couralabs/pi-tdah/agent-mode"), DEFAULT_AGENT_MODE);

/** The current agent mode. */
export function getAgentMode(): AgentMode {
	return store.get();
}

/** Set the current agent mode and notify subscribers. No-op when unchanged. */
export function setAgentMode(mode: AgentMode): void {
	store.set(mode);
}

/** Subscribe to mode changes; returns an unsubscribe function. */
export function subscribeAgentMode(listener: (mode: AgentMode) => void): () => void {
	return store.subscribe(listener);
}

const MODE_COLOR: Record<AgentMode, { text: ThemeColor; border: ThemeColor }> = {
	pi: { text: "accent", border: "accent" },
	work: { text: "text", border: "border" },
};

/** Footer label color: Pi is accented, Work uses the default foreground. */
export function agentModeColor(mode: AgentMode): ThemeColor {
	return MODE_COLOR[mode].text;
}

/** Prompt-field border color: Pi is accented, Work keeps the default border. */
export function agentModeBorderColor(mode: AgentMode): ThemeColor {
	return MODE_COLOR[mode].border;
}
