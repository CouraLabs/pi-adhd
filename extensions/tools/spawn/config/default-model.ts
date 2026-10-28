import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { debugLog } from "../debug.ts";
import { type DefaultModelRef } from "../session/model-resolver.ts";

export function resolveConfiguredDefaultModel(cwd: string): DefaultModelRef | undefined {
	try {
		const settingsManager = SettingsManager.create(cwd, getAgentDir());
		const provider = settingsManager.getDefaultProvider();
		const modelId = settingsManager.getDefaultModel();
		if (!provider || !modelId) return undefined;
		return { provider, id: modelId };
	} catch (err) {
		debugLog("resolveConfiguredDefaultModel", err);
		return undefined;
	}
}
