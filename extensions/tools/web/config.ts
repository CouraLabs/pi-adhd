/**
 * config.ts — Web provider settings, persisted in the pi-adhd settings file.
 */

import { loadSettings, updateSettings } from "../../../shared/settings.ts";

export interface WebProviderConfig {
	/** Provider id, or "auto" to try every configured provider in order. */
	provider: string;
	/** Model the 9Router aggregator fetches/searches with. */
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
