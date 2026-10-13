/**
 * modes — two agent modes for pi: Work (default) and Pi.
 *
 *   - Work replaces pi's default system prompt with the pi-adhd Work rules
 *     (see `prompts/work.md`), turning the agent into an orchestrator that
 *     delegates to spawned agents and tracks work with the todo tool.
 *   - Pi leaves pi's default system prompt untouched.
 *
 * Switch modes with `/mode [pi|work]`. The footer shows the active mode and the
 * prompt field recolors its border. The mode is session-scoped: every switch is
 * snapshotted into a `mode-state` session entry and restored from the current
 * branch on session start, so two pi instances (or two sessions in one process)
 * never share a mode and a value cannot leak through the shared settings file.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { isGoalActive, switchBlockedByGoalMessage } from "../../../shared/interlock.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { offloadPrompt, readUserPrompt } from "../../../shared/user-prompts.ts";
import {
	DEFAULT_AGENT_MODE,
	MODE_NOTICE,
	MODE_STATE_ENTRY_TYPE,
	getAgentMode,
	restoreModeFromEntries,
	setAgentMode,
	type AgentMode,
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
	/** Set the mode and snapshot it into the session. Returns false when goal
	 *  mode blocks the switch. */
	const applyMode = (mode: AgentMode): boolean => {
		if (isGoalActive()) return false;
		if (mode === getAgentMode()) return true;
		setAgentMode(mode);
		pi.appendEntry(MODE_STATE_ENTRY_TYPE, { mode });
		return true;
	};
	/** Restore the branch-local mode: the latest valid snapshot wins, else the
	 *  default. Called on session start and tree navigation. */
	const restoreMode = (ctx: ExtensionContext): void => {
		const restored = restoreModeFromEntries(ctx.sessionManager.getBranch());
		setAgentMode(restored ?? DEFAULT_AGENT_MODE);
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

	// Work mode swaps in the pi-adhd Work rules; Pi mode leaves the default
	// prompt (or a user SYSTEM.md) in place. `customPrompt` replaces pi's
	// default system prompt, matching how SYSTEM.md is applied. Read fresh each
	// run so edits to the user prompt file apply without a reload.
	pi.on("before_agent_start", (event) => {
		if (childSession) return;
		if (getAgentMode() === "work") {
			event.systemPromptOptions.customPrompt = readUserPrompt("modes", "work.md", packagedWorkPrompt);
		}
	});

	pi.registerCommand("mode", {
		description: "Switch agent mode (usage: /mode [pi|work])",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			const previous = getAgentMode();
			let next: AgentMode;
			if (arg === "pi" || arg === "work") {
				next = arg;
			} else if (arg === "") {
				next = getAgentMode() === "work" ? "pi" : "work";
			} else {
				ctx.ui.notify("Usage: /mode [pi|work]", "warning");
				return;
			}
			if (!applyMode(next)) {
				ctx.ui.notify(switchBlockedByGoalMessage(), "warning");
				return;
			}
			// A restore on session_start is not a change, and a no-op switch (the
			// requested mode is already active) changes nothing — only announce an
			// actual transition.
			if (getAgentMode() === previous) return;
			ctx.ui.notify(MODE_NOTICE[next], "info");
		},
	});
}
