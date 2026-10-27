import { loadSettings, updateSettings, type SessionTitleConfig } from "../../../shared/settings.ts";

export function loadSessionTitleConfig(): SessionTitleConfig {
	return loadSettings().sessionTitle;
}

export function saveSessionTitleConfig(patch: Partial<SessionTitleConfig>): SessionTitleConfig {
	return updateSettings({ sessionTitle: patch }).sessionTitle;
}
