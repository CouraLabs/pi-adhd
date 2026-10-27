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

export interface ModelInfo {
  parentModel: Model<any> | undefined;
  modelRegistry: ModelRegistry | undefined;
}

export interface SpawnIdentity {
  spawnType: string;
  rawType: SpawnType;
  fellBack: boolean;
  displayName: string;
}

export interface SpawnExecution {
  prompt: string;
  description: string;
  model: Model<any> | undefined;
  effectiveMaxTurns: number | undefined;
  thinking: ThinkingLevel | undefined;
  inheritContext: boolean;
  agentInvocation: AgentInvocation;
}

export interface SpawnPresentation {
  agentTags: string[];
  detailBase: Pick<AgentDetails, "displayName" | "description" | "spawnType" | "modelName" | "tags">;
}

export interface ResolvedSpawnConfig {
  identity: SpawnIdentity;
  execution: SpawnExecution;
  presentation: SpawnPresentation;

  notes: string[];
}

export interface SpawnConfigError {
  error: string;
}

export function resolveSpawnConfig(
  params: Record<string, unknown>,
  registry: AgentTypeRegistry,
  modelInfo: ModelInfo,
  settings: { readonly defaultMaxTurns: number | undefined },
): ResolvedSpawnConfig | SpawnConfigError {

  const thinkingParam = params.thinking;
  const thinkingFromParams = parseThinkingLevel(thinkingParam);
  if (thinkingParam != null && thinkingFromParams === undefined) {
    return { error: thinkingLevelError(thinkingParam) };
  }

  const rawType = params.spawn_type as SpawnType;
  const resolved = registry.resolveType(rawType);

  const spawnType = resolved ?? "general-purpose";
  const fellBack = resolved === undefined;

  const displayName = getDisplayName(spawnType, registry);

  const customConfig = registry.resolveAgentConfig(spawnType);
  const resolvedConfig = resolveAgentInvocationConfig(customConfig, {
    ...params,
    thinking: thinkingFromParams,
  });

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

export function buildFallbackNote(rawType: SpawnType, fellBack: boolean): string[] {
  return fellBack ? [`Note: Unknown agent type "${rawType}" — using general-purpose.`] : [];
}

function buildMinimumTurnsNote(maxTurns: number | undefined): string[] {
  if (!isBelowMinimumTurns(maxTurns)) return [];
  return [
    `Note: max_turns ${maxTurns} is below the minimum of ${MIN_MAX_TURNS} (one turn to work, one to answer), so the spawn runs with ${MIN_MAX_TURNS}.`,
  ];
}

function buildLockNote(agentName: string, discarded: readonly LockableField[]): string[] {
  if (discarded.length === 0) return [];
  const tail =
    discarded.length === 1
      ? `so the ${discarded[0]} parameter was ignored`
      : "so those parameters were ignored";
  return [`Note: agent "${agentName}" locks ${discarded.join(", ")}, ${tail}.`];
}
