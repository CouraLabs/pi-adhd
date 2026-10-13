/**
 * modes — two agent modes for pi: Work (default) and Pi.
 *
 *   - Work replaces pi's default system prompt with the pi-tdah Work rules
 *     (see `prompts/work.md`), turning the agent into an orchestrator that
 *     delegates to spawned agents and tracks work with the todo tool.
 *   - Pi leaves pi's default system prompt untouched.
 *
 * Switch modes with `/mode [pi|work]`. The footer shows the active mode and the
 * prompt field recolors its border. The selected mode is persisted in the
 * pi-tdah settings file and restored on the next session.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isGoalActive, switchBlockedByGoalMessage } from "../../shared/interlock.ts";
import { loadSettings, updateSettings } from "../../shared/settings.ts";
import {
	DEFAULT_AGENT_MODE,
	MODE_NOTICE,
	getAgentMode,
	setAgentMode,
	type AgentMode,
} from "../../shared/modes.ts";

// Prompt lives in a static .md asset next to this module (published with the
// package). Loaded at runtime: pi loads extensions through jiti, which does
// not support bundler-style text imports (pi-dynamic-workflows precedent).
const workPrompt = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "work.md"),
	"utf8",
);

function isAgentMode(value: unknown): value is AgentMode {
	return value === "pi" || value === "work";
}

export default function (pi: ExtensionAPI) {
	/** Set the mode and persist it. Returns false when goal mode blocks the switch. */
	const applyMode = (mode: AgentMode): boolean => {
		if (isGoalActive()) return false;
		setAgentMode(mode);
		updateSettings({ modes: { current: mode } });
		return true;
	};

	pi.on("session_start", () => {
		const stored = loadSettings().modes.current;
		setAgentMode(isAgentMode(stored) ? stored : DEFAULT_AGENT_MODE);
	});

	// Work mode swaps in the pi-tdah Work rules; Pi mode leaves the default
	// prompt (or a user SYSTEM.md) in place. `customPrompt` replaces pi's
	// default system prompt, matching how SYSTEM.md is applied.
	pi.on("before_agent_start", (event) => {
		if (getAgentMode() === "work") {
			event.systemPromptOptions.customPrompt = workPrompt;
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
