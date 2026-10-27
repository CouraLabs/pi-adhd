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

const packagedWorkPrompt = readFileSync(
	path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts", "work.md"),
	"utf8",
);

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("modes");

	offloadPrompt("modes", "work.md", packagedWorkPrompt);

	let childSession = false;

	let previousMode: SelectableAgentMode | undefined;

	const applyMode = (mode: AgentMode): void => {
		if (mode === getAgentMode()) return;
		setAgentMode(mode);
		pi.appendEntry(MODE_STATE_ENTRY_TYPE, { mode, previousMode });
	};

	const restoreMode = (ctx: ExtensionContext): void => {
		const snapshot = restoreModeSnapshotFromEntries(ctx.sessionManager.getBranch());
		const selectable: SelectableAgentMode =
			snapshot?.mode === CLAUDE_MODE || snapshot === undefined
				? (snapshot?.previousMode ?? DEFAULT_AGENT_MODE)
				: snapshot.mode;

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

			if (getAgentMode() === current) return;
			ctx.ui.notify(modeNotice(next), "info");
		},
	});
}
