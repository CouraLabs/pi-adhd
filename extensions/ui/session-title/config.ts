/**
 * config — the session-title extension's slice of the pi-adhd settings file.
 *
 * Lives under the `sessionTitle` key of `~/.pi/couralabs/settings.json`,
 * so every pi-adhd knob stays in one place:
 *
 *   sessionTitle: {
 *     "enabled": true,
 *     "model": "anthropic/claude-haiku-5-5"   // optional
 *   }
 *
 * `model` is written by `/couralabs:session-title` as `provider/id`. When it
 * is unset, the generating model falls back to the session's current model at
 * generation time, so the feature works before any model is configured.
 */

import { loadSettings, updateSettings, type SessionTitleConfig } from "../../../shared/settings.ts";

/** Read the stored session-title configuration. */
export function loadSessionTitleConfig(): SessionTitleConfig {
	return loadSettings().sessionTitle;
}

/** Merge a patch into the stored session-title section and persist it. */
export function saveSessionTitleConfig(patch: Partial<SessionTitleConfig>): SessionTitleConfig {
	return updateSettings({ sessionTitle: patch }).sessionTitle;
}
