import { loadSettings, updateSettings } from "../../../shared/settings.ts";

export interface WebProviderConfig {

	provider: string;

	nineRouterModel: string;
}

export function getFetchConfig(): WebProviderConfig {
	return loadSettings().web.fetch;
}

export function saveFetchConfig(patch: Partial<WebProviderConfig>): void {
	updateSettings({ web: { fetch: patch } });
}

export function getSearchConfig(): WebProviderConfig {
	return loadSettings().web.search;
}

export function saveSearchConfig(patch: Partial<WebProviderConfig>): void {
	updateSettings({ web: { search: patch } });
}
