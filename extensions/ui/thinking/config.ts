import { DEFAULT_SETTINGS, loadSettings, type ThinkingConfig } from "../../../shared/settings.ts";

function normalize(raw: ThinkingConfig): ThinkingConfig {
	return {
		useSummaryTitlesAsThinkingTitle: raw.useSummaryTitlesAsThinkingTitle !== false,
		previewLines:
			Number.isInteger(raw.previewLines) && raw.previewLines >= 0
				? raw.previewLines
				: DEFAULT_SETTINGS.thinking.previewLines,
		animationIntervalMs:
			Number.isFinite(raw.animationIntervalMs) && raw.animationIntervalMs >= 1
				? raw.animationIntervalMs
				: DEFAULT_SETTINGS.thinking.animationIntervalMs,
	};
}

let cached: ThinkingConfig = { ...DEFAULT_SETTINGS.thinking };

export function refreshThinkingConfig(): ThinkingConfig {
	cached = normalize(loadSettings().thinking);
	return cached;
}

export function thinkingConfig(): ThinkingConfig {
	return cached;
}
