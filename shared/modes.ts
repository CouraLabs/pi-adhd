/**
 * modes — shared agent-mode state for pi-adhd.
 *
 * pi-adhd has one built-in mode and any number of user modes:
 *
 *   - `"pi"`: leaves pi's default system prompt untouched.
 *   - any other id: a user mode, defined by a `<id>.md` file in
 *     `~/.pi/couralabs/prompts/modes/`. Activating it replaces pi's default
 *     system prompt with the file's content. The packaged Work rules are
 *     offloaded to that folder as `work.md`, so Work is an ordinary user mode.
 *
 * The state lives on `globalThis`, keyed by a registered symbol, so every
 * pi-adhd extension — the `modes` extension that owns the switch, the
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { MODE_CUSTOM, MODE_PI, MODE_WORK } from "./glyphs.ts";
import { getUserPromptsDir } from "./user-prompts.ts";
import { createGlobalStore } from "./store.ts";

/** The built-in escape-hatch mode id: keeps pi's default system prompt. */
export const PI_MODE = "pi";

/** A mode id: `"pi"` or the stem of a `.md` file in the user modes folder. */
export type AgentMode = string;

/** The mode a fresh install starts in. */
export const DEFAULT_AGENT_MODE: AgentMode = "work";

/** Directory holding the user mode prompts (`<mode>.md` files). */
export function userModesDir(): string {
	return join(getUserPromptsDir(), "modes");
}

/**
 * Every available mode: the stems of the `.md` files in the user modes folder
 * plus pi, sorted alphabetically (pi sorts in with the file names, so a bare
 * `/mode` cycles through the whole list in one alphabetical order). Always
 * contains at least pi. An unreadable or missing folder degrades to just pi.
 */
export function listAgentModes(): AgentMode[] {
	const names: string[] = [];
	try {
		if (existsSync(userModesDir())) {
			for (const file of readdirSync(userModesDir())) {
				if (file.endsWith(".md")) names.push(file.slice(0, -3));
			}
		}
	} catch {
		// Unreadable home, sandbox: pi stays available without user modes.
	}
	return [...new Set([...names, PI_MODE])].sort((a, b) =>
		a.toLowerCase().localeCompare(b.toLowerCase()),
	);
}

/** The next mode after `current` in the alphabetical cycle, wrapping around. */
export function nextAgentMode(current: AgentMode, modes: readonly AgentMode[]): AgentMode {
	// An unknown current (deleted mode file) falls back to the first entry.
	return modes[(modes.indexOf(current) + 1) % modes.length];
}

/**
 * Read a user mode's prompt. Returns undefined when the file is missing,
 * unreadable, or blank, so the caller degrades to pi's default prompt instead
 * of swapping in an empty system prompt.
 */
export function readModePrompt(mode: AgentMode): string | undefined {
	try {
		const path = join(userModesDir(), `${mode}.md`);
		const text = existsSync(path) ? readFileSync(path, "utf8") : "";
		return text.trim() ? text : undefined;
	} catch {
		return undefined;
	}
}

/** Capitalized display form of a mode id ("manager" → "Manager"). */
function modeDisplayName(mode: AgentMode): string {
	return mode.charAt(0).toUpperCase() + mode.slice(1);
}

/** Human-readable mode name shown in the footer, glyph included. */
export function agentModeLabel(mode: AgentMode): string {
	if (mode === PI_MODE) return `${MODE_PI} Pi`;
	if (mode === "work") return `${MODE_WORK} Work`;
	return `${MODE_CUSTOM} ${modeDisplayName(mode)}`;
}

/** One-sentence explanation of what a mode does, shown when it becomes active. */
export function modeNotice(mode: AgentMode): string {
	if (mode === PI_MODE) {
		return `${agentModeLabel(mode)}. pi's default system prompt is in effect — no pi-adhd rules are added, so the agent answers in its own voice with pi's built-in guidance and the full toolset.`;
	}
	return `${modeDisplayName(mode)}. The pi-adhd mode '${mode}' replace Pi's default system prompt.`;
}

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

/**
 * Reconstruct the agent mode from session entries: the latest `mode-state`
 * snapshot reachable on the current branch wins; malformed entries are skipped
 * so a corrupt entry can never break startup. Returns the raw stored id — the
 * caller must still check it against `listAgentModes()`, because a mode file
 * may have been deleted since the snapshot was taken — or undefined when the
 * branch carries no snapshot, so the caller applies its own default.
 */
export function restoreModeFromEntries(entries: readonly unknown[]): AgentMode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== MODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { mode?: unknown } | undefined;
		if (typeof data?.mode === "string" && data.mode.trim()) return data.mode;
	}
	return undefined;
}

/**
 * Footer label color: Work uses the default foreground, Pi and user modes are
 * accented. The label text itself already distinguishes Pi from user modes.
 */
export function agentModeColor(mode: AgentMode): ThemeColor {
	return mode === "work" ? "text" : "accent";
}

/**
 * Prompt-field border color: Pi is accented, user modes use the accent-tinted
 * border, Work keeps the default border.
 */
export function agentModeBorderColor(mode: AgentMode): ThemeColor {
	if (mode === PI_MODE) return "accent";
	return mode === "work" ? "border" : "borderAccent";
}
