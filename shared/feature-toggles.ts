/**
 * feature-toggles — settings-backed pi-adhd toggles that are not extensions.
 *
 * `/couralabs:toggle` lists two kinds of items: extensions (the `extensions`
 * array in `~/.pi/couralabs/settings.json`, owned by
 * `shared/extension-control.ts`) and feature toggles — plain boolean settings
 * that change how a loaded extension behaves without loading or unloading
 * anything. This module is the single list of what may appear as a feature
 * toggle, the way `shared/extension-catalog.ts` is for extensions.
 */

import { loadSettings, updateSettings } from "./settings.ts";

/** One non-extension toggle shown by `/couralabs:toggle`. */
export interface FeatureToggleEntry {
	/** Stable identifier, accepted as the `/couralabs:toggle` argument. */
	readonly id: string;
	/** Display name in the toggle dialog. */
	readonly label: string;
	/** One-line summary shown in the dialog and command usage. */
	readonly description: string;
	/** Whether the feature is currently enabled in settings. */
	readonly isEnabled: () => boolean;
	/** Persist the new state. Takes effect the next time the owning extension reads settings. */
	readonly setEnabled: (enabled: boolean) => void;
}

/** Every feature toggle, in dialog order. */
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

/** Resolve operator input (id, case-insensitive) to a feature toggle. */
export function resolveFeatureToggle(input: string): FeatureToggleEntry | undefined {
	const needle = input.trim().toLowerCase();
	return FEATURE_TOGGLES.find((entry) => entry.id.toLowerCase() === needle);
}

/** Comma-separated feature-toggle ids, for usage and error messages. */
export function featureToggleIdList(): string {
	return FEATURE_TOGGLES.map((entry) => entry.id).join(", ");
}
