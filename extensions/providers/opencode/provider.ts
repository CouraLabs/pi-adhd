import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchFreeModels, freeBaseUrl, goBaseUrl, staticFreeModels } from "./catalog.ts";
import { OPENCODE_ANONYMOUS_KEY, OPENCODE_CATALOG_URL, OPENCODE_FREE_ID, opencodeHeaders } from "./identity.ts";
import { createOpencodeStreamSimple } from "./stream.ts";

const CATALOG_TIMEOUT_MS = 10000;

let liveFreeModels: ProviderModelConfig[] | undefined;

export function currentFreeModels(): ProviderModelConfig[] {
	return liveFreeModels ?? staticFreeModels(freeBaseUrl());
}

function withIdentityHeaders(models: ProviderModelConfig[]): ProviderModelConfig[] {
	return models.map((model) => ({ ...model, headers: opencodeHeaders() }));
}

export async function refreshFreeCatalog(): Promise<ProviderModelConfig[]> {
	try {
		liveFreeModels = await fetchFreeModels(OPENCODE_CATALOG_URL, freeBaseUrl(), CATALOG_TIMEOUT_MS);
	} catch {
		liveFreeModels = undefined;
	}
	return currentFreeModels();
}

export function freeProviderConfig(): ProviderConfig {
	return {
		name: "OpenCode Free",
		baseUrl: freeBaseUrl(),
		apiKey: OPENCODE_ANONYMOUS_KEY,
		api: "openai-completions",
		models: withIdentityHeaders(currentFreeModels()),
		streamSimple: createOpencodeStreamSimple(true),
		refreshModels: async () => refreshFreeCatalog(),
	};
}

export function goProviderConfig(): ProviderConfig {
	return {
		name: "OpenCode Go",
		baseUrl: goBaseUrl(),
		apiKey: "$OPENCODE_API_KEY",
		api: "openai-completions",
		models: withIdentityHeaders(staticFreeModels(goBaseUrl())),
		streamSimple: createOpencodeStreamSimple(false),
	};
}

export function freeProviderId(): string {
	return OPENCODE_FREE_ID;
}
