import type { Model } from "@earendil-works/pi-ai";

export interface ModelRegistry {
  find(provider: string, modelId: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable?(): Model<any>[];
}

export interface ModelResolutionResult {
  model: Model<any> | undefined;
  error?: undefined;

  fallbackNote?: string;
}

export interface ModelResolutionError {
  model?: undefined;
  error: string;
}

export type ModelResolution = ModelResolutionResult | ModelResolutionError;

export function resolveInvocationModel(
  parentModel: Model<any> | undefined,
  modelInput: string | undefined,
  modelFromParams: boolean,
  registry: ModelRegistry | undefined,
): ModelResolution {
  if (!modelInput) return { model: parentModel };
  if (!registry) {
    if (modelFromParams) return { error: "No model registry available." };
    return {
      model: parentModel,
      fallbackNote: `Agent model "${modelInput}" could not be resolved (no model registry available), so the spawn runs on the session model.`,
    };
  }
  const resolved = resolveModel(modelInput, registry);
  if (typeof resolved !== "string") return { model: resolved };
  if (modelFromParams) return { error: resolved };
  return {
    model: parentModel,
    fallbackNote: `Agent model "${modelInput}" did not match an available model, so the spawn runs on the session model instead.`,
  };
}

export function resolveModel(
  input: string,
  registry: ModelRegistry,
): Model<any> | string {

  const available = registry.getAvailable?.() ?? registry.getAll();

  const slashIdx = input.indexOf("/");
  if (slashIdx !== -1) {
    const provider = input.slice(0, slashIdx);
    const modelId = input.slice(slashIdx + 1);
    const exact = registry.find(provider, modelId);
    if (exact) return exact;
  }

  const bestMatch = findBestFuzzyMatch(available, input.toLowerCase());
  if (bestMatch) {
    const found = registry.find(bestMatch.provider, bestMatch.id);
    if (found) return found;
  }

  const modelList = available
    .map(m => `  ${m.provider}/${m.id}`)
    .sort()
    .join("\n");
  return `Model not found: "${input}".\n\nAvailable models:\n${modelList}`;
}

function findBestFuzzyMatch(all: Model<any>[], query: string): Model<any> | undefined {
  let bestMatch: Model<any> | undefined;
  let bestScore = 0;

  for (const m of all) {
    const id = m.id.toLowerCase();
    const name = m.name.toLowerCase();
    const full = `${m.provider}/${m.id}`.toLowerCase();

    let score = 0;
    if (id === query || full === query) {
      score = 100;
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + (query.length / id.length) * 30;
    } else if (name.includes(query)) {
      score = 40 + (query.length / name.length) * 20;
    } else if (query.split(/[\s\-/]+/).every(part => id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))) {
      score = 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  return bestScore >= 20 ? bestMatch : undefined;
}
