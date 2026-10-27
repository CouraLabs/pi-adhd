/**
 * modes — pi's built-in mode plus user-defined agent modes.
 *
 *   - Pi leaves pi's default system prompt untouched.
 *   - Every other mode is a `<name>.md` file in
 *     `~/.pi/couralabs/prompts/modes/`; activating it replaces pi's default
 *     system prompt with that file's content. The packaged Work rules are
 *     offloaded there as `work.md`, so Work is an ordinary user mode.
 *
 * A Claude provider model forces the reserved automatic Claude mode (`/mode`
 * is refused while it is active); changing back to another model restores the
 * previous mode.
 *
 * `/mode` cycles through all modes in alphabetical order (pi sorts in with
 * the file names), `/mode <name>` switches to a named mode, and an unknown
 * name reports the available ones. The footer shows the active mode and the
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { offloadPrompt } from "../../../shared/user-prompts.ts";
import {
	CLAUDE_MODE,
	DEFAULT_AGENT_MODE,
	PI_MODE,
	MODE_STATE_ENTRY_TYPE,
	getAgentMode,
	isClaudeProvider,
	listAgentModes,
	modeNotice,
	nextAgentMode,
	readModePrompt,
	restoreModeSnapshotFromEntries,
	setAgentMode,
	type AgentMode,
	type SelectableAgentMode,
} from "../../../shared/modes.ts";

// Prompt lives in a static .md asset next to this module (published with the
// package). Loaded at runtime: pi loads extensions through jiti, which does
// not support bundler-style text imports (pi-dynamic-workflows precedent).
// The asset is the packaged fallback: at load time the extension copies it to
// ~/.pi/couralabs/prompts/modes/work.md (once) and reads the prompt from
// there on every run, so user edits apply without touching the package.
const packagedWorkPrompt = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "work.md"),
	"utf8",
);

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("modes");

	// Offload the packaged prompt to the editable user folder (no-op when it is
	// already there) so the user can edit it; every run then reads that file.
	offloadPrompt("modes", "work.md", packagedWorkPrompt);
	/** Whether this instance belongs to a spawned child session, which stays
	 *  inert so it never publishes the parent's mode or overrides its own
	 *  prompt with the parent's. */
	let childSession = false;
	/** The mode to return to when the Claude mode ends. */
	let previousMode: SelectableAgentMode | undefined;
	/** Set the mode and snapshot it, with the mode to return to, into the session. */
	const applyMode = (mode: AgentMode): void => {
		if (mode === getAgentMode()) return;
		setAgentMode(mode);
		pi.appendEntry(MODE_STATE_ENTRY_TYPE, { mode, previousMode });
	};
	/** Restore the branch-local mode: the latest valid snapshot wins, else the
	 *  default. The active model decides whether the Claude mode applies, so a
	 *  snapshot never keeps the Claude mode on a non-Claude model or drops it on a
	 *  Claude one. Called on session start and tree navigation. */
	const restoreMode = (ctx: ExtensionContext): void => {
		const snapshot = restoreModeSnapshotFromEntries(ctx.sessionManager.getBranch());
		const selectable: SelectableAgentMode =
			snapshot?.mode === CLAUDE_MODE || snapshot === undefined
				? (snapshot?.previousMode ?? DEFAULT_AGENT_MODE)
				: snapshot.mode;
		// A snapshot can name a mode whose file has since been deleted; it then
		// falls back to the default rather than activating a promptless mode.
		const resolved = listAgentModes().includes(selectable) ? selectable : DEFAULT_AGENT_MODE;
		if (isClaudeProvider(ctx.model?.provider)) {
			previousMode = resolved;
			setAgentMode(CLAUDE_MODE);
			return;
		}
		previousMode = undefined;
		setAgentMode(resolved);
	};

	pi.on("session_start", (_event, ctx) => {
		childSession = isChildSession(ctx.sessionManager.getSessionId());
		if (childSession) return;
		restoreMode(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (childSession) return;
		restoreMode(ctx);
	});

	// Entering a Claude model forces the Claude mode and remembers the mode it
	// replaced; leaving Claude restores that mode.
	pi.on("model_select", (event) => {
		if (childSession) return;
		const current = getAgentMode();
		if (isClaudeProvider(event.model.provider)) {
			if (current === "claude") return;
			previousMode = current;
			applyMode("claude");
			return;
		}
		if (current !== "claude") return;
		const restored = previousMode ?? DEFAULT_AGENT_MODE;
		previousMode = undefined;
		applyMode(restored);
	});

	// Work mode swaps in the pi-adhd Work rules; Pi mode leaves the default
	// prompt (or a user SYSTEM.md) in place, as does a user mode whose file
	// vanished mid-session. The Claude mode leaves the prompt alone too: the
	// Claude Agent SDK owns the system prompt. `customPrompt` replaces pi's
	// default system prompt, matching how SYSTEM.md is applied. Read fresh each
	// run so edits to the mode file apply without a reload.
	pi.on("before_agent_start", (event) => {
		if (childSession) return;
		const mode = getAgentMode();
		if (mode === PI_MODE || mode === CLAUDE_MODE) return;
		const prompt = readModePrompt(mode);
		if (prompt !== undefined) event.systemPromptOptions.customPrompt = prompt;
	});

	pi.registerCommand("mode", {
		description: "Switch agent mode (/mode cycles, /mode <name> selects)",
		handler: async (args, ctx) => {
			const arg = args.trim();
			const modes = listAgentModes();
			const current = getAgentMode();
			if (current === CLAUDE_MODE) {
				ctx.ui.notify(
					"/mode is unavailable while a Claude model is active: the Claude Agent SDK owns the system prompt. Switch to another model first.",
					"warning",
				);
				return;
			}
			let next: SelectableAgentMode;
			if (arg === "") {
				// Cycle to the next mode in alphabetical order, wrapping around; an
				// unknown current mode falls back to the first entry.
				next = nextAgentMode(current, modes);
			} else {
				const match = modes.find((mode) => mode.toLowerCase() === arg.toLowerCase());
				if (match === undefined) {
					ctx.ui.notify(`Unknown mode '${arg}'. Available: ${modes.join(", ")}`, "warning");
					return;
				}
				next = match;
			}
			applyMode(next);
			// A restore on session_start is not a change, and a no-op switch (the
			// requested mode is already active) changes nothing — only announce an
			// actual transition.
			if (getAgentMode() === current) return;
			ctx.ui.notify(modeNotice(next), "info");
		},
	});
}
