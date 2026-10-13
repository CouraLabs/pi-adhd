/**
 * spawn-config.ts — Pure config resolution for the Agent tool.
 *
 * Extracts all config resolution logic from execute: type resolution,
 * invocation config merge, model resolution, max-turns normalization,
 * tag building, and detail-base construction.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { AgentTypeRegistry } from "../config/agent-types.ts";
import { type LockableField, resolveAgentInvocationConfig } from "../config/invocation-config.ts";
import { parseThinkingLevel, thinkingLevelError } from "../config/thinking-level.ts";
import { isBelowMinimumTurns, MIN_MAX_TURNS, normalizeMaxTurns } from "../lifecycle/turn-limits.ts";
import type { ModelRegistry } from "../session/model-resolver.ts";
import { resolveInvocationModel } from "../session/model-resolver.ts";
import type { AgentInvocation, SpawnType, ThinkingLevel } from "../types.ts";
import {
  type AgentDetails,
  buildInvocationTags,
  getDisplayName,
  getPromptModeLabel,
  modelLabel,
} from "../ui/display.ts";

/** Model info extracted from the parent session context. */
export interface ModelInfo {
  parentModel: Model<any> | undefined;
  modelRegistry: ModelRegistry | undefined;
}

/** Identity: who is being spawned. */
export interface SpawnIdentity {
  spawnType: string;
  rawType: SpawnType;
  fellBack: boolean;
  displayName: string;
}

/** Execution: how the agent will run. */
export interface SpawnExecution {
  prompt: string;
  description: string;
  model: Model<any> | undefined;
  effectiveMaxTurns: number | undefined;
  thinking: ThinkingLevel | undefined;
  inheritContext: boolean;
  agentInvocation: AgentInvocation;
}

/** Presentation: display/UI values derived from identity and execution. */
export interface SpawnPresentation {
  agentTags: string[];
  detailBase: Pick<AgentDetails, "displayName" | "description" | "spawnType" | "modelName" | "tags">;
}

/** Fully resolved config for spawning an agent — composed of domain-aligned sub-interfaces. */
export interface ResolvedSpawnConfig {
  identity: SpawnIdentity;
  execution: SpawnExecution;
  presentation: SpawnPresentation;
  /** Model-visible advisories about how this spawn resolved. Both runners render them. */
  notes: string[];
}

/** Error result when model resolution fails. */
export interface SpawnConfigError {
  error: string;
}

/**
 * Resolve all config for an Agent tool invocation.
 *
 * Pure function — no SDK types, no side effects.
 * Returns either a fully resolved config or an error.
 */
export function resolveSpawnConfig(
  params: Record<string, unknown>,
  registry: AgentTypeRegistry,
  modelInfo: ModelInfo,
  settings: { readonly defaultMaxTurns: number | undefined },
): ResolvedSpawnConfig | SpawnConfigError {
  // Validated at the door, so the merge below and every layer past it receive a
  // level the SDK recognizes rather than one it would clamp to "off" (Refs #834).
  const thinkingParam = params.thinking;
  const thinkingFromParams = parseThinkingLevel(thinkingParam);
  if (thinkingParam != null && thinkingFromParams === undefined) {
    return { error: thinkingLevelError(thinkingParam) };
  }

  const rawType = params.spawn_type as SpawnType;
  const resolved = registry.resolveType(rawType);

  // A disabled type is rejected by SpawnManager.resolveSpawn, the choke point
  // every front door shares.
  const spawnType = resolved ?? "general-purpose";
  const fellBack = resolved === undefined;

  const displayName = getDisplayName(spawnType, registry);

  // Merge agent config defaults with tool-call params
  const customConfig = registry.resolveAgentConfig(spawnType);
  const resolvedConfig = resolveAgentInvocationConfig(customConfig, {
    ...params,
    thinking: thinkingFromParams,
  });

  // Resolve model
  const resolution = resolveInvocationModel(
    modelInfo.parentModel,
    resolvedConfig.modelInput,
    resolvedConfig.modelFromParams,
    modelInfo.modelRegistry,
  );
  if (resolution.error !== undefined) return { error: resolution.error };
  const model = resolution.model;
  const modelFallbackNote = resolution.fallbackNote ? [resolution.fallbackNote] : [];

  const thinking = resolvedConfig.thinking;
  const inheritContext = resolvedConfig.inheritContext;

  const modelName = modelLabel(model);

  const effectiveMaxTurns = normalizeMaxTurns(
    resolvedConfig.maxTurns ?? settings.defaultMaxTurns,
  );

  const agentInvocation: AgentInvocation = {
    thinking,
    maxTurns: normalizeMaxTurns(resolvedConfig.maxTurns),
    inheritContext,
  };

  const modeLabel = getPromptModeLabel(spawnType, registry);
  const { tags: invocationTags } = buildInvocationTags(agentInvocation);
  const agentTags = modeLabel ? [modeLabel, ...invocationTags] : invocationTags;

  const detailBase = {
    displayName,
    description: params.description as string,
    spawnType,
    modelName,
    tags: agentTags.length > 0 ? agentTags : undefined,
  };

  return {
    identity: { spawnType, rawType, fellBack, displayName },
    notes: [
      ...buildFallbackNote(rawType, fellBack),
      ...buildLockNote(spawnType, resolvedConfig.discarded),
      ...buildMinimumTurnsNote(resolvedConfig.maxTurns),
      ...modelFallbackNote,
    ],
    execution: {
      prompt: params.prompt as string,
      description: params.description as string,
      model,
      effectiveMaxTurns,
      thinking,
      inheritContext,
      agentInvocation,
    },
    presentation: { agentTags, detailBase },
  };
}

/** Advise that the named type does not exist, so general-purpose ran instead. */
export function buildFallbackNote(rawType: SpawnType, fellBack: boolean): string[] {
  return fellBack ? [`Note: Unknown agent type "${rawType}" — using general-purpose.`] : [];
}

/**
 * Advise that the resolved max_turns was raised to the minimum.
 *
 * The value came from this call or from the agent file, and either way the caller
 * would otherwise read a budget it never got.
 */
function buildMinimumTurnsNote(maxTurns: number | undefined): string[] {
  if (!isBelowMinimumTurns(maxTurns)) return [];
  return [
    `Note: max_turns ${maxTurns} is below the minimum of ${MIN_MAX_TURNS} (one turn to work, one to answer), so the spawn runs with ${MIN_MAX_TURNS}.`,
  ];
}

/**
 * Advise that the agent's `locked:` frontmatter threw away parameters this call passed.
 *
 * The caller cannot see an agent file, so a silent discard reads as the tool ignoring
 * a parameter its own schema documents — which is the defect #829 reports.
 */
function buildLockNote(agentName: string, discarded: readonly LockableField[]): string[] {
  if (discarded.length === 0) return [];
  const tail =
    discarded.length === 1
      ? `so the ${discarded[0]} parameter was ignored`
      : "so those parameters were ignored";
  return [`Note: agent "${agentName}" locks ${discarded.join(", ")}, ${tail}.`];
}
