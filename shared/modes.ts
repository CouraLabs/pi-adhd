/**
 * modes — shared agent-mode state for pi-adhd.
 *
 * pi-adhd has two agent modes:
 *
 *   - `"work"` (default): replaces pi's default system prompt with the
 *     pi-adhd Work rules and makes the agent orchestrate via spawned agents.
 *   - `"pi"`: leaves pi's default system prompt untouched.
 *
 * The state lives on `globalThis`, keyed by a registered symbol, so every
 * pi-adhd extension — the `modes` extension that owns the toggle, the
 * `footer` that draws the label, and the `editor` that colors its border —
 * reads and mutates the same value even when their modules are loaded twice.
 * Extensions subscribe to re-render when the mode changes.
 *
 * The value is session-scoped, not global configuration: the `modes` extension
 * snapshots it into a `mode-state` session entry on every switch and restores
 * the branch-local snapshot on `session_start`. Two pi instances (or two
 * sessions in one process) therefore never share a mode — the store only
 * mirrors the active session for the in-process extensions that read it.
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
	pi: `${AGENT_MODE_LABEL.pi}. pi's default system prompt is in effect — no pi-adhd rules are added, so the agent answers in its own voice with pi's built-in guidance and the full toolset.`,
	work: `${AGENT_MODE_LABEL.work}. The pi-adhd Work rules replace the default system prompt: the agent orchestrates, delegating exploration and implementation to spawned agents, asks before assuming, and tracks progress with the todo tool.`,
};

const store = createGlobalStore<AgentMode>(Symbol.for("@couralabs/pi-adhd/agent-mode"), DEFAULT_AGENT_MODE);

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

/** Session entry customType for agent-mode snapshots (see pi.appendEntry). */
export const MODE_STATE_ENTRY_TYPE = "mode-state";

/** Whether `value` is an agent mode; guards session snapshots and user input. */
export function isAgentMode(value: unknown): value is AgentMode {
	return value === "pi" || value === "work";
}

/**
 * Reconstruct the agent mode from session entries: the latest valid
 * `mode-state` snapshot reachable on the current branch wins; malformed entries
 * are skipped so a corrupt entry can never break startup. Returns undefined
 * when the branch carries no snapshot, so the caller applies its own default.
 */
export function restoreModeFromEntries(entries: readonly unknown[]): AgentMode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== MODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { mode?: unknown } | undefined;
		if (isAgentMode(data?.mode)) return data.mode;
	}
	return undefined;
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
