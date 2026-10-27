/**
 * command — the `/couralabs:session-title` command.
 *
 * The command reports the feature's state — enabled or disabled, and the
 * model that writes the titles — then opens a model picker for what runs the
 * next naming call. The picker offers every auth-configured model plus a
 * "session model" entry that clears the stored override; picking any model
 * also enables the feature, so one selection both configures and turns it on.
 * Disabling is `/couralabs:toggle session-title`.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { loadSessionTitleConfig, saveSessionTitleConfig } from "./config.ts";

/** The picker entry that clears the stored override; the session's current
 *  model then writes titles at generation time. */
const SESSION_MODEL_OPTION = "Session model (no override)";

/** `provider/id`, the same spelling `/spawn:model` and the settings file use. */
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

			// Current override first, so the pick that is in force is one keystroke away.
			const options: { label: string; value: string | undefined }[] = [];
			if (config.enabled) options.push({ label: "Turn off", value: "off" });
			else options.push({ label: "Turn on", value: "on" });
			if (config.model) options.push({ label: SESSION_MODEL_OPTION, value: undefined });
			for (const model of models) {
				const id = modelId(model);
				options.push({ label: id === config.model ? `${id} — current` : id, value: id });
			}

			const choice = await ctx.ui.select(`Session title — ${status}, model: ${modelLabel}`, options.map((option) => option.label));
			if (!choice) return; // esc leaves everything as it was
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
			// A model pick (or the clear-override entry): persist, and make sure the
			// feature is on so the selection takes effect this session.
			const saved = saveSessionTitleConfig({ model: picked.value, enabled: true });
			ctx.ui.notify(
				`Session titles ${saved.enabled ? "enabled" : "disabled"} · model: ${saved.model ?? "session model"}`,
				"info",
			);
		},
	});
}
