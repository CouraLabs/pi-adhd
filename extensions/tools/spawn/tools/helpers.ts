import type { AgentConfigLookup } from "../config/agent-types.ts";
import type { TurnBudget } from "../lifecycle/turn-limits.ts";
import { getLifetimeTotal, toUsageTotals, type LifetimeUsage } from "../lifecycle/usage.ts";
import { type AgentDetails, formatTokens, type ModelIdentity, modelLabel } from "../ui/display.ts";

export function buildDetails(
  base: Pick<AgentDetails, "displayName" | "description" | "spawnType" | "modelName" | "tags">,
  record: {
    toolUses: number;
    startedAt: number;
    completedAt?: number;
    status: string;
    error?: string;
    id?: string;
    lifetimeUsage: LifetimeUsage;

    model?: ModelIdentity;
    turnBudget?: TurnBudget;
  },
  overrides?: Partial<AgentDetails>,
): AgentDetails {
  return {
    ...base,
    modelName: modelLabel(record.model) ?? base.modelName,
    toolUses: record.toolUses,
    tokens: formatLifetimeTokens(record),
    usage: toUsageTotals(record.lifetimeUsage),
    durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
    status: record.status as AgentDetails["status"],
    agentId: record.id,
    error: record.error,
    turnBudget: record.turnBudget,
    ...overrides,
  };
}

export function renderSpawnNotes(notes: readonly string[]): string {
  return notes.length > 0 ? `${notes.join("\n")}\n\n` : "";
}

export function textResult<T = AgentDetails>(msg: string, details?: T) {
  return { content: [{ type: "text" as const, text: msg }], details };
}

export function formatLifetimeTokens(o: { lifetimeUsage: LifetimeUsage }): string {
  const t = getLifetimeTotal(o.lifetimeUsage);
  return t > 0 ? formatTokens(t) : "";
}

export interface TypeListRegistry extends AgentConfigLookup {
  getDefaultAgentNames(): string[];
  getUserAgentNames(): string[];
}

export function buildTypeListText(registry: TypeListRegistry): string {
  const defaultNames = registry.getDefaultAgentNames().filter((name) => isEnabledAgent(registry, name));
  const userNames = registry.getUserAgentNames().filter((name) => isEnabledAgent(registry, name));

  const defaultDescs = defaultNames.map((name) => {
    const cfg = registry.resolveAgentConfig(name);
    const modelSuffix = cfg.model ? ` (${getModelLabelFromConfig(cfg.model)})` : "";
    return `- ${name}: ${cfg.description}${modelSuffix}`;
  });

  const customDescs = userNames.map((name) => {
    const cfg = registry.resolveAgentConfig(name);
    return `- ${name}: ${cfg.description}`;
  });

  return [
    ...(defaultDescs.length > 0 ? ["Default agents:", ...defaultDescs] : []),
    ...(customDescs.length > 0 ? ["", "Custom agents:", ...customDescs] : []),
    "",
    `Custom agents can be defined in .agents/agents/<name>.md (project) or ~/.agents/agents/<name>.md (global) — they are picked up automatically. Project-level agents override global ones. Creating a .md file with the same name as a default agent overrides it.`,
  ].join("\n");
}

function isEnabledAgent(registry: AgentConfigLookup, name: string): boolean {
  return registry.resolveAgentConfig(name).enabled !== false;
}

export function buildAgentGuidelines(registry: TypeListRegistry): string[] {
  return registry
    .getDefaultAgentNames()
    .filter((name) => isEnabledAgent(registry, name))
    .map((name) => registry.resolveAgentConfig(name).toolGuideline)
    .filter((line): line is string => line !== undefined);
}

export function getModelLabelFromConfig(model: string): string {

  const name = model.includes("/") ? model.split("/").pop()! : model;

  return name.replace(/-\d{8}(?=(?:\[1m\])?$)/i, "");
}
