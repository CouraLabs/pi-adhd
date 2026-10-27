import type { AgentConfig, ThinkingLevel } from "../types.ts";

export const LOCKABLE_FIELDS = [
  "model",
  "thinking",
  "max_turns",
  "inherit_context",
] as const;

export type LockableField = (typeof LOCKABLE_FIELDS)[number];

export type LockDeclaration = true | readonly LockableField[];

export function isLockableField(name: string): name is LockableField {
  return (LOCKABLE_FIELDS as readonly string[]).includes(name);
}

interface AgentInvocationParams {
  model?: string;

  thinking?: ThinkingLevel;
  max_turns?: number;
  inherit_context?: boolean;
}

export interface AgentInvocationConfig {
  modelInput?: string;

  modelFromParams: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;

  discarded: LockableField[];
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig,
  params: AgentInvocationParams,
): AgentInvocationConfig {
  const locked = agentConfig.locked;
  const model = resolveField("model", agentConfig.model, params.model, locked);
  const thinking = resolveField("thinking", agentConfig.thinking, params.thinking, locked);
  const maxTurns = resolveField("max_turns", agentConfig.maxTurns, params.max_turns, locked);
  const inheritContext = resolveField(
    "inherit_context",
    agentConfig.inheritContext,
    params.inherit_context,
    locked,
  );

  return {
    modelInput: model.value,
    modelFromParams: model.source === "caller",
    thinking: thinking.value,
    maxTurns: maxTurns.value,
    inheritContext: inheritContext.value ?? false,
    discarded: [model, thinking, maxTurns, inheritContext]
      .filter((resolution) => resolution.discarded)
      .map((resolution) => resolution.field),
  };
}

interface FieldResolution<T> {
  field: LockableField;
  value: T | undefined;
  source: "caller" | "agent" | "none";

  discarded: boolean;
}

function resolveField<T>(
  field: LockableField,
  agentValue: T | undefined,
  callerValue: T | undefined,
  locked: LockDeclaration | undefined,
): FieldResolution<T> {
  if (!isLocked(field, agentValue, locked) && callerValue !== undefined) {
    return { field, value: callerValue, source: "caller", discarded: false };
  }
  const discarded = callerValue !== undefined && callerValue !== agentValue;
  return agentValue !== undefined
    ? { field, value: agentValue, source: "agent", discarded }
    : { field, value: undefined, source: "none", discarded };
}

function isLocked(
  field: LockableField,
  agentValue: unknown,
  locked: LockDeclaration | undefined,
): boolean {
  if (locked === undefined) return false;
  return locked === true ? agentValue !== undefined : locked.includes(field);
}
