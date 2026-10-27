import { loadSettings, updateSettings } from "./settings.ts";

export interface FeatureToggleEntry {

	readonly id: string;

	readonly label: string;

	readonly description: string;

	readonly isEnabled: () => boolean;

	readonly setEnabled: (enabled: boolean) => void;
}

export const FEATURE_TOGGLES: readonly FeatureToggleEntry[] = [
	{
		id: "session-title",
		label: "Session titles",
		description: "Name each session from its last user prompt; /couralabs:session-title picks the model",
		isEnabled: () => loadSettings().sessionTitle.enabled,
		setEnabled: (enabled) => {
			updateSettings({ sessionTitle: { enabled } });
		},
	},
];

export function resolveFeatureToggle(input: string): FeatureToggleEntry | undefined {
	const needle = input.trim().toLowerCase();
	return FEATURE_TOGGLES.find((entry) => entry.id.toLowerCase() === needle);
}

export function featureToggleIdList(): string {
	return FEATURE_TOGGLES.map((entry) => entry.id).join(", ");
}
