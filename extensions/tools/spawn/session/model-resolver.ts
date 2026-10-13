/**
 * Model resolution: exact match ("provider/modelId") with fuzzy fallback.
 */
import type { Model } from "@earendil-works/pi-ai";

export interface ModelRegistry {
  find(provider: string, modelId: string): Model<any> | undefined;
  getAll(): Model<any>[];
  getAvailable?(): Model<any>[];
}

/** Successful model resolution — `model` is the resolved or inherited model instance. */
export interface ModelResolutionResult {
  model: Model<any> | undefined;
  error?: undefined;
  /**
   * Set when a model string supplied by the agent's configuration (not the
   * caller) failed to resolve and the parent model was used instead. The
   * caller renders it as an advisory so a configured model degrades loudly
   * rather than silently.
   */
  fallbackNote?: string;
}

/** Failed model resolution when the model was user-specified (params) — surface the error. */
export interface ModelResolutionError {
  model?: undefined;
  error: string;
}

/** Discriminated union returned by `resolveInvocationModel`. */
export type ModelResolution = ModelResolutionResult | ModelResolutionError;

/**
 * Resolve the effective model for an agent invocation.
 *
 * Encapsulates the three-branch fallback policy used in `Agent.execute`:
 * 1. No `modelInput` → inherit `parentModel`.
 * 2. `modelInput` resolves → return the resolved model.
 * 3. `modelInput` fails:
 *    - `modelFromParams` true  → return `{ error }` so the caller can surface it.
 *    - `modelFromParams` false → fall back to `parentModel`, with a
 *      `fallbackNote` the caller renders — a configured model that stops
 *      resolving must not degrade silently onto the session model.
 *
 * `modelFromParams` reports which side supplied the winning string, not merely whether
 * the caller passed one — a caller whose value an agent's `locked:` frontmatter discarded
 * did not win, so its typo is not the string being resolved here.
 */
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

/**
 * Resolve a model string to a Model instance.
 *
 * An exact "provider/modelId" reference is looked up in the FULL registry,
 * not just the available set: an explicitly named model is a deliberate
 * choice, and the available snapshot only lists models whose provider passed
 * an auth/availability pass — a pass that runs asynchronously for
 * extension-registered providers and can be empty or stale at spawn time.
 * Gating the exact match on it silently discarded every configured agent
 * model onto the parent's model. An unresolvable exact reference still
 * surfaces as an error string; a model that exists but lacks auth fails
 * loudly at request time, which beats silently running on the wrong model.
 *
 * Fuzzy matching stays restricted to available models, so a guess never
 * lands on a provider with no credentials.
 * Returns the Model on success, or an error message string on failure.
 */
export function resolveModel(
  input: string,
  registry: ModelRegistry,
): Model<any> | string {
  // Available models (those with auth configured), for fuzzy matching.
  const available = registry.getAvailable?.() ?? registry.getAll();

  // 1. Exact match: "provider/modelId" — full registry, availability aside.
  const slashIdx = input.indexOf("/");
  if (slashIdx !== -1) {
    const provider = input.slice(0, slashIdx);
    const modelId = input.slice(slashIdx + 1);
    const exact = registry.find(provider, modelId);
    if (exact) return exact;
  }

  // 2. Fuzzy match against available models
  const bestMatch = findBestFuzzyMatch(available, input.toLowerCase());
  if (bestMatch) {
    const found = registry.find(bestMatch.provider, bestMatch.id);
    if (found) return found;
  }

  // 3. No match — list available models
  const modelList = available
    .map(m => `  ${m.provider}/${m.id}`)
    .sort()
    .join("\n");
  return `Model not found: "${input}".\n\nAvailable models:\n${modelList}`;
}

/**
 * Score each candidate model — prefer exact id match > id contains > name
 * contains > provider+id contains — and return the best match at or above
 * the acceptance threshold (20), or undefined if nothing scores high enough.
 */
function findBestFuzzyMatch(all: Model<any>[], query: string): Model<any> | undefined {
  let bestMatch: Model<any> | undefined;
  let bestScore = 0;

  for (const m of all) {
    const id = m.id.toLowerCase();
    const name = m.name.toLowerCase();
    const full = `${m.provider}/${m.id}`.toLowerCase();

    let score = 0;
    if (id === query || full === query) {
      score = 100; // exact
    } else if (id.includes(query) || full.includes(query)) {
      score = 60 + (query.length / id.length) * 30; // substring, prefer tighter matches
    } else if (name.includes(query)) {
      score = 40 + (query.length / name.length) * 20;
    } else if (query.split(/[\s\-/]+/).every(part => id.includes(part) || name.includes(part) || m.provider.toLowerCase().includes(part))) {
      score = 20; // all parts present somewhere
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = m;
    }
  }

  return bestScore >= 20 ? bestMatch : undefined;
}
