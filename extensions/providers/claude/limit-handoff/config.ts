import { loadSettings, updateSettings } from "../../../../shared/settings.ts";

export function loadHandoffModelId(): string | undefined {
	return loadSettings().claudeLimitHandoff.model;
}

export function saveHandoffModelId(modelId: string | undefined): void {
	updateSettings({ claudeLimitHandoff: { model: modelId } });
}
