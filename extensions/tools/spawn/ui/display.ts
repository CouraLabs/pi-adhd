import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "../config/agent-types.ts";
import type { TurnBudget } from "../lifecycle/turn-limits.ts";
import type { AgentInvocation, SpawnType } from "../types.ts";
import type { UsageTotals } from "../../../../shared/usage.ts";

export interface ModelIdentity {
  readonly provider: string;
  readonly id: string;
}

export type Theme = {
  fg(color: ThemeColor, text: string): string;
  bold(text: string): string;
};

export interface AgentDetails {
  displayName: string;
  description: string;
  spawnType: string;
  toolUses: number;
  tokens: string;
  durationMs: number;
  status: "running" | "completed" | "aborted" | "stopped" | "error";

  activity?: string;

  spinnerFrame?: number;

  modelName?: string;

  tags?: string[];
  agentId?: string;
  error?: string;

  turnBudget?: TurnBudget;

  usage?: UsageTotals;
}

const TOOL_DISPLAY: Record<string, string> = {
  read: "reading",
  bash: "running command",
  edit: "editing",
  write: "writing",
  grep: "searching",
  find: "finding files",
  ls: "listing",
};

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
  return `${count} token`;
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatModel(model: ModelIdentity): string {
  return `${model.provider}/${model.id}`;
}

export function modelLabel(model: ModelIdentity | undefined): string | undefined {
  return model ? formatModel(model) : undefined;
}

export function formatDuration(startedAt: number, completedAt?: number): string {
  if (completedAt) return formatMs(completedAt - startedAt);
  return `${formatMs(Date.now() - startedAt)} (running)`;
}

export function getDisplayName(type: SpawnType, registry: AgentConfigLookup): string {
  const config = registry.resolveAgentConfig(type);
  return config.displayName ?? config.name;
}

export function getPromptModeLabel(type: SpawnType, registry: AgentConfigLookup): string | undefined {
  const config = registry.resolveAgentConfig(type);
  return config.promptMode === "append" ? "twin" : undefined;
}

export function buildInvocationTags(
  invocation: AgentInvocation | undefined,
): { tags: string[] } {
  const tags: string[] = [];
  if (!invocation) return { tags };
  if (invocation.thinking) tags.push(`thinking: ${invocation.thinking}`);
  if (invocation.inheritContext) tags.push("inherit context");
  if (invocation.maxTurns != null) tags.push(`max turns: ${invocation.maxTurns}`);
  return { tags };
}

function truncateLine(text: string, len = 60): string {
  const line = text.split("\n").find(l => l.trim())?.trim() ?? "";
  if (line.length <= len) return line;
  return line.slice(0, len) + "…";
}

export function describeActivity(activeTools: ReadonlyMap<string, string>, responseText?: string): string {
  if (activeTools.size > 0) {
    const groups = new Map<string, number>();
    for (const toolName of activeTools.values()) {
      const action = TOOL_DISPLAY[toolName] ?? toolName;
      groups.set(action, (groups.get(action) ?? 0) + 1);
    }

    const parts: string[] = [];
    for (const [action, count] of groups) {
      if (count > 1) {
        parts.push(`${action} ${count} ${action === "searching" ? "patterns" : "files"}`);
      } else {
        parts.push(action);
      }
    }
    return parts.join(", ") + "…";
  }

  if (responseText && responseText.trim().length > 0) {
    return truncateLine(responseText);
  }

  return "thinking…";
}
