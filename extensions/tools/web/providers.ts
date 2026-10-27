export type FetchFormat = "markdown" | "text" | "html";

export interface FetchRequest {
	url: string;
	format: FetchFormat;
	maxCharacters: number;
	signal?: AbortSignal;
}

export interface FetchResponse {
	title?: string;
	url: string;
	content: string;
}

export interface FetchProvider {
	id: string;
	fetch: (request: FetchRequest) => Promise<FetchResponse>;
	isConfigured?: () => boolean;

	env?: string[];
}

const REGISTRY = Symbol.for("@couralabs/pi-adhd/providers");

function providers(): Map<string, FetchProvider> {
	const root = globalThis as typeof globalThis & { [REGISTRY]?: Map<string, FetchProvider> };
	if (!root[REGISTRY]) root[REGISTRY] = new Map();
	return root[REGISTRY];
}

export function registerFetchProvider(provider: FetchProvider): void {
	if (!provider.id.trim()) throw new Error("A fetch provider needs an id");
	providers().set(provider.id, provider);
}

export function getFetchProvider(id: string): FetchProvider | undefined {
	return providers().get(id);
}

export function listFetchProviders(): FetchProvider[] {
	return [...providers().values()].filter((provider) => provider.isConfigured?.() ?? true);
}

export function listAllFetchProviders(): Array<{
	id: string;
	configured: boolean;
	env: string[];
}> {
	return [...providers().values()].map((provider) => ({
		id: provider.id,
		configured: provider.isConfigured?.() ?? true,
		env: provider.env ?? [],
	}));
}
