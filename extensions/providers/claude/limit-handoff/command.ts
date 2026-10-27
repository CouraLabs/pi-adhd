import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { CLAUDE_PROVIDER_ID } from "../../../../shared/modes.ts";
import { loadHandoffModelId, saveHandoffModelId } from "./config.ts";

const WAIT_OPTION = "No handoff — wait for reset and auto-continue";

function modelId(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function describeCurrent(current: string | undefined): string {
	return current ?? "none (wait for reset)";
}

export function registerLimitHandoffCommand(pi: ExtensionAPI): void {
	pi.registerCommand("couralabs:claude-limit-handoff", {
		description: "Pick the model that takes over when the Claude rate limit is reached",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const current = loadHandoffModelId();
			ctx.ui.notify(`Claude limit handoff: ${describeCurrent(current)}`, "info");
			if (!ctx.hasUI) return;

			const candidates = (ctx.scopedModels.length > 0 ? ctx.scopedModels.map((scoped) => scoped.model) : ctx.modelRegistry.getAvailable())
				.filter((model) => model.provider !== CLAUDE_PROVIDER_ID)
				.sort((a, b) => modelId(a).localeCompare(modelId(b)));

			const options: { label: string; value: string | undefined }[] = [
				{ label: current === undefined ? `${WAIT_OPTION} — current` : WAIT_OPTION, value: undefined },
				...candidates.map((model) => {
					const id = modelId(model);
					return { label: id === current ? `${id} — current` : id, value: id };
				}),
			];

			const choice = await ctx.ui.select(
				`Claude limit handoff — current: ${describeCurrent(current)}`,
				options.map((option) => option.label),
			);
			const picked = options.find((option) => option.label === choice);
			if (!picked) return;

			saveHandoffModelId(picked.value);
			ctx.ui.notify(`Claude limit handoff: ${describeCurrent(picked.value)}`, "info");
		},
	});
}
