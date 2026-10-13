/**
 * thinking/config — the compact renderer's knobs.
 *
 * Unlike the upstream `pi-compact-thinking` extension (which keeps its own
 * `compact-thinking.json`), the settings live in pi-tdah's shared
 * `~/.pi/couralabs/settings.json` under the `thinking` key, so every pi-tdah
 * knob stays in one file. The defaults themselves live next to the schema in
 * `shared/settings.ts` (`DEFAULT_SETTINGS.thinking`), so this module holds no
 * second copy. The shared loader merges in defaults, so a missing key is
 * already filled; hand-edited values are clamped to a safe range here rather
 * than allowed to break rendering or spin the animation timer.
 */

import { DEFAULT_SETTINGS, loadSettings, type ThinkingConfig } from "../../shared/settings.ts";

function normalize(raw: ThinkingConfig): ThinkingConfig {
	return {
		enabled: raw.enabled !== false,
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

// A copy, not an alias: thinkingConfig() hands this object out to callers.
let cached: ThinkingConfig = { ...DEFAULT_SETTINGS.thinking };

/** Re-read the settings file and refresh the cached configuration. */
export function refreshThinkingConfig(): ThinkingConfig {
	cached = normalize(loadSettings().thinking);
	return cached;
}

/** The configuration snapshot for the current session. */
export function thinkingConfig(): ThinkingConfig {
	return cached;
}
