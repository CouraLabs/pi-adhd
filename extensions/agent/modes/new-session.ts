import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
	MODE_STATE_ENTRY_TYPE,
	agentModeLabel,
	getAgentMode,
	isClaudeProvider,
	listAgentModes,
	readModeDeclaration,
	setAgentMode,
	type SelectableAgentMode,
} from "../../../shared/modes.ts";
import { stagePendingModeRequest, takePendingModeRequest } from "../../../shared/pending-mode-request.ts";
import { applyModeModel, resolveModeModelSwitch } from "./model-switch.ts";
import { resolveConfiguredDefaultModel } from "../../tools/spawn/config/default-model.ts";

function resolveModeArgument(arg: string): { mode?: SelectableAgentMode; error?: string } {
	const modes = listAgentModes();
	const exact = modes.find((mode) => mode.toLowerCase() === arg.toLowerCase());
	if (exact !== undefined) return { mode: exact };
	const prefixMatches = modes.filter((mode) => mode.toLowerCase().startsWith(arg.toLowerCase()));
	if (prefixMatches.length === 1) return { mode: prefixMatches[0] };
	if (prefixMatches.length > 1) {
		return { error: `'${arg}' matches several modes: ${prefixMatches.join(", ")}` };
	}
	return { error: `Unknown mode '${arg}'. Available: ${modes.join(", ")}` };
}

function modeCompletions(prefix: string): AutocompleteItem[] {
	const query = prefix.trim().toLowerCase();
	return listAgentModes()
		.filter((mode) => mode.toLowerCase().startsWith(query))
		.map((mode) => ({ value: mode, label: agentModeLabel(mode) }));
}

export function registerNewSessionCommand(pi: ExtensionAPI): void {
	pi.registerCommand("n", {
		description: "New session, optionally in a mode (/n [mode])",
		getArgumentCompletions: (prefix) => modeCompletions(prefix),
		handler: async (args, ctx) => {
			const query = args.trim();
			if (query === "") {
				await ctx.newSession({
					withSession: async (newCtx) => newCtx.ui.notify("New session started", "info"),
				});
				return;
			}
			if (isClaudeProvider(ctx.model?.provider)) {
				ctx.ui.notify(
					"/n is unavailable while a Claude model is active: the Claude Agent SDK owns the system prompt. Switch to another model first.",
					"warning",
				);
				return;
			}
			const resolved = resolveModeArgument(query);
			if (resolved.error !== undefined || resolved.mode === undefined) {
				ctx.ui.notify(resolved.error ?? "Unknown mode", "warning");
				return;
			}
			const target = resolved.mode;
			const precheck = resolveModeModelSwitch(
				readModeDeclaration(target),
				ctx.model,
				ctx.modelRegistry,
				resolveConfiguredDefaultModel(ctx.cwd),
			);
			if (precheck.error !== undefined) {
				ctx.ui.notify(`Cannot start a new session in ${agentModeLabel(target)}: ${precheck.error}`, "error");
				return;
			}
			const previousMode = getAgentMode();
			await ctx.newSession({
				setup: async (sessionManager) => {
					setAgentMode(target);
					sessionManager.appendCustomEntry(MODE_STATE_ENTRY_TYPE, { mode: target, previousMode });
					stagePendingModeRequest(sessionManager.getSessionId(), target);
				},
			});
		},
	});
}

export async function applyStagedModeModel(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const staged = takePendingModeRequest(ctx.sessionManager.getSessionId());
	if (staged === undefined) return;
	const result = await applyModeModel(pi, ctx, staged.mode);
	if (result.error !== undefined) {
		ctx.ui.notify(result.error, "error");
		return;
	}
	const modelLine = result.switchTo ? ` Model set to ${result.switchTo.name}.` : "";
	ctx.ui.notify(`${agentModeLabel(getAgentMode())} active in the new session.${modelLine}`, "info");
}
