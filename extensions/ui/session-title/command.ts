import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { loadSessionTitleConfig, saveSessionTitleConfig } from "./config.ts";

const SESSION_MODEL_OPTION = "Session model (no override)";

function modelId(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

export function registerSessionTitleCommand(pi: ExtensionAPI): void {
	pi.registerCommand("couralabs:session-title", {
		description: "Show session-title state and pick the model that names sessions",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const config = loadSessionTitleConfig();
			const status = config.enabled ? "enabled" : "disabled";
			const modelLabel = config.model ?? "session model";
			ctx.ui.notify(`Session titles are ${status} · model: ${modelLabel}`, "info");
			if (!ctx.hasUI) return;

			const models = [...(ctx.scopedModels.length > 0 ? ctx.scopedModels.map((scoped) => scoped.model) : ctx.modelRegistry.getAvailable())].sort(
				(a, b) => modelId(a).localeCompare(modelId(b)),
			);
			if (models.length === 0) {
				ctx.ui.notify("No models are available; session titles keep their current settings.", "warning");
				return;
			}

			const options: { label: string; value: string | undefined }[] = [];
			if (config.enabled) options.push({ label: "Turn off", value: "off" });
			else options.push({ label: "Turn on", value: "on" });
			if (config.model) options.push({ label: SESSION_MODEL_OPTION, value: undefined });
			for (const model of models) {
				const id = modelId(model);
				options.push({ label: id === config.model ? `${id} — current` : id, value: id });
			}

			const choice = await ctx.ui.select(`Session title — ${status}, model: ${modelLabel}`, options.map((option) => option.label));
			if (!choice) return;
			const picked = options.find((option) => option.label === choice);
			if (!picked) return;

			if (picked.value === "off") {
				saveSessionTitleConfig({ enabled: false });
				ctx.ui.notify("Session titles disabled", "info");
				return;
			}
			if (picked.value === "on") {
				saveSessionTitleConfig({ enabled: true });
				ctx.ui.notify("Session titles enabled", "info");
				return;
			}

			const saved = saveSessionTitleConfig({ model: picked.value, enabled: true });
			ctx.ui.notify(
				`Session titles ${saved.enabled ? "enabled" : "disabled"} · model: ${saved.model ?? "session model"}`,
				"info",
			);
		},
	});
}
