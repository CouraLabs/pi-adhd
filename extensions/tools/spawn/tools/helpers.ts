import type { AgentConfig } from "../types.ts";
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

export interface TypeListRegistry {
  list(): AgentConfig[];
}

export function buildTypeListText(registry: TypeListRegistry): string {
  const enabled = registry.list().filter((config) => config.enabled !== false);
  const globalAgents = enabled.filter((config) => config.source !== "project");
  const projectAgents = enabled.filter((config) => config.source === "project");

  const globalDescs = globalAgents.map(agentListLine);
  const projectDescs = projectAgents.map(agentListLine);

  return [
    ...(globalDescs.length > 0 ? ["Global agents:", ...globalDescs] : []),
    ...(projectDescs.length > 0 ? ["", "Project agents:", ...projectDescs] : []),
    "",
    `Agents are defined in ~/.pi/agents/<name>.md (global) and .pi/agents/<name>.md (project, same name replaces the global one wholesale); ~/.agents/agents/ and .agents/agents/ are also read as additional sources.`,
  ].join("\n");
}

function agentListLine(config: AgentConfig): string {
  const modelSuffix = config.model ? ` (${getModelLabelFromConfig(config.model)})` : "";
  return `- ${config.name}: ${config.description}${modelSuffix}`;
}

export function buildAgentGuidelines(registry: TypeListRegistry): string[] {
  return registry
    .list()
    .filter((config) => config.enabled !== false)
    .map((config) => config.toolGuideline)
    .filter((line): line is string => line !== undefined);
}

export function getModelLabelFromConfig(model: string): string {

  const name = model.includes("/") ? model.split("/").pop()! : model;

  return name.replace(/-\d{8}(?=(?:\[1m\])?$)/i, "");
}
