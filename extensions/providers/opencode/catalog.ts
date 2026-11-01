import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { OPENCODE_GO_BASE_URL, OPENCODE_INFERENCE_BASE_URL } from "./identity.ts";

export const OPENCODE_FREE_MODEL_IDS = [
	"big-pickle",
	"beam-free",
	"flint-40b-free",
	"mimo-v2.6-flash-free",
	"nemotron-3.5-super-vl-free",
	"nemotron-3.5-lightning-free",
	"deepseek-v4.1-flash-free",
	"glm-5.3-flash-free",
] as const;

const FALLBACK_CONTEXT_WINDOW = 200000;

const FALLBACK_MAX_TOKENS = 32000;

interface CatalogEntry {
	id?: unknown;
	name?: unknown;
	description?: unknown;
	limit?: { context?: unknown; output?: unknown };
	cost?: { text?: { input?: { price?: unknown }; output?: { price?: unknown } } };
}

function toPositiveInt(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isFreeEntry(entry: CatalogEntry): boolean {
	const inputPrice = entry.cost?.text?.input?.price;
	const outputPrice = entry.cost?.text?.output?.price;
	if (typeof inputPrice === "number" || typeof outputPrice === "number") {
		return (typeof inputPrice !== "number" || inputPrice === 0) && (typeof outputPrice !== "number" || outputPrice === 0);
	}
	return typeof entry.id === "string" && (entry.id === "big-pickle" || entry.id.toLowerCase().includes("free"));
}

function toModelConfig(entry: CatalogEntry, baseUrl: string): ProviderModelConfig | undefined {
	if (typeof entry.id !== "string" || entry.id.length === 0) return undefined;
	const label = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id;
	return {
		id: entry.id,
		name: label,
		api: "openai-completions",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: toPositiveInt(entry.limit?.context, FALLBACK_CONTEXT_WINDOW),
		maxTokens: toPositiveInt(entry.limit?.output, FALLBACK_MAX_TOKENS),
	};
}

export function staticFreeModels(baseUrl: string): ProviderModelConfig[] {
	return OPENCODE_FREE_MODEL_IDS.map((id) => ({
		id,
		name: id,
		api: "openai-completions",
		baseUrl,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: FALLBACK_CONTEXT_WINDOW,
		maxTokens: FALLBACK_MAX_TOKENS,
	}));
}

export function selectFreeModels(payload: unknown, baseUrl: string): ProviderModelConfig[] {
	const entries = (payload as { data?: unknown })?.data;
	if (!Array.isArray(entries)) return [];
	const models: ProviderModelConfig[] = [];
	for (const raw of entries) {
		const entry = raw as CatalogEntry;
		if (!isFreeEntry(entry)) continue;
		const model = toModelConfig(entry, baseUrl);
		if (model) models.push(model);
	}
	return models;
}

export async function fetchFreeModels(catalogUrl: string, baseUrl: string, timeoutMs: number): Promise<ProviderModelConfig[]> {
	const response = await fetch(catalogUrl, {
		headers: { Accept: "application/json", "User-Agent": "pi-adhd" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) throw new Error(`opencode catalog HTTP ${response.status}`);
	const payload: unknown = await response.json();
	const models = selectFreeModels(payload, baseUrl);
	if (models.length === 0) throw new Error("opencode catalog returned no free models");
	return models;
}

export function freeBaseUrl(): string {
	return OPENCODE_INFERENCE_BASE_URL;
}

export function goBaseUrl(): string {
	return OPENCODE_GO_BASE_URL;
}
