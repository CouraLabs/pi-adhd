export type SearchType = "web" | "news";

export interface SearchRequest {
	query: string;
	searchType: SearchType;
	maxResults: number;
	signal?: AbortSignal;
}

export interface SearchResultItem {
	title: string;
	url: string;
	snippet: string;
	publishedAt?: string;
}

export interface SearchProvider {
	id: string;
	search: (request: SearchRequest) => Promise<SearchResultItem[]>;
	isConfigured?: () => boolean;
	env?: string[];
}

const REGISTRY = Symbol.for("@couralabs/pi-adhd/search-providers");

function providers(): Map<string, SearchProvider> {
	const root = globalThis as typeof globalThis & { [REGISTRY]?: Map<string, SearchProvider> };
	if (!root[REGISTRY]) root[REGISTRY] = new Map();
	return root[REGISTRY];
}

export function registerSearchProvider(provider: SearchProvider): void {
	if (!provider.id.trim()) throw new Error("A search provider needs an id");
	providers().set(provider.id, provider);
}

export function getSearchProvider(id: string): SearchProvider | undefined {
	return providers().get(id);
}

export function listSearchProviders(): SearchProvider[] {
	return [...providers().values()].filter((provider) => provider.isConfigured?.() ?? true);
}

export function listAllSearchProviders(): Array<{
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
