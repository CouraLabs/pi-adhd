/**
 * subagent-model.ts — the `/subagent-model` command: pick a subagent, then a
 * model, and persist the choice.
 *
 * Built-in agents (`general-purpose`, `plan-reviewer`, `Arquitect`,
 * `Code-Review`, `Explore`) have no markdown file, so their choice is stored in
 * the pi-pack settings file (`subagents.agentModels`). A
 * custom agent loaded from `.agents/agents/*.md` gets `model:` written into its
 * own frontmatter instead.
 *
 * The handler takes a narrow injected UI (the same shape `SessionNavigatorHandler`
 * uses) so it stays unit-testable and free of the SDK surface.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { writeAgentModel } from "../config/agent-model-file.ts";
import type { AgentConfig } from "../types.ts";

/** The slice of the extension UI the model picker needs. */
export interface SubagentModelUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface SubagentModelParams {
  ui: SubagentModelUI;
  /** Every agent the registry knows, in display order. */
  agents: readonly AgentConfig[];
  cwd: string;
  /** Auth-configured models, already resolved by the caller. */
  models: readonly Model<any>[];
  /** Persist a built-in agent's model. */
  setAgentModel: (agentName: string, modelId: string) => void;
}

/** Where an agent came from, as the picker labels it. */
type SourceLabel = "built-in" | "project" | "global";

/** Display order of the source groups. */
const SOURCE_RANK: Record<SourceLabel, number> = { "built-in": 0, project: 1, global: 2 };

/** One selectable agent, with its group-qualified label. */
interface AgentEntry {
  label: string;
  agent: AgentConfig;
}

/** `source` narrows to the picker's three groups; anything else reads as a built-in. */
function sourceLabel(agent: AgentConfig): SourceLabel {
  if (agent.source === "project") return "project";
  if (agent.source === "global") return "global";
  return "built-in";
}

/** A built-in has no file of its own, so its choice lives in the settings map. */
function isBuiltIn(agent: AgentConfig): boolean {
  return agent.source === undefined || agent.source === "default";
}

export class SubagentModelHandler {
  async handle(params: SubagentModelParams): Promise<void> {
    const { ui } = params;

    const entries: AgentEntry[] = params.agents
      .map((agent) => ({ label: `${agent.name} — ${sourceLabel(agent)}`, agent }))
      .sort((a, b) => {
        const rank = SOURCE_RANK[sourceLabel(a.agent)] - SOURCE_RANK[sourceLabel(b.agent)];
        return rank !== 0 ? rank : a.agent.name.localeCompare(b.agent.name);
      });

    if (entries.length === 0) {
      ui.notify("No subagents are available.", "info");
      return;
    }

    const agentChoice = await ui.select("Select a subagent", entries.map((e) => e.label));
    if (!agentChoice) return;
    const entry = entries.find((candidate) => candidate.label === agentChoice);
    if (!entry) return;

    const modelLabels = params.models
      .map((model) => `${model.provider}/${model.id}`)
      .sort((a, b) => a.localeCompare(b));
    if (modelLabels.length === 0) {
      ui.notify("No models are available.", "info");
      return;
    }

    const modelChoice = await ui.select(`Model for ${entry.agent.name}`, modelLabels);
    if (!modelChoice) return;

    if (isBuiltIn(entry.agent)) {
      params.setAgentModel(entry.agent.name, modelChoice);
      ui.notify(`${entry.agent.name} now uses ${modelChoice}.`, "info");
      return;
    }

    const path =
      entry.agent.source === "project"
        ? join(params.cwd, ".agents", "agents", `${entry.agent.name}.md`)
        : join(homedir(), ".agents", "agents", `${entry.agent.name}.md`);
    try {
      const content = readFileSync(path, "utf8");
      writeFileSync(path, writeAgentModel(content, modelChoice), "utf8");
    } catch (error) {
      ui.notify(`Could not write the model to ${path}: ${errorMessage(error)}`, "error");
      return;
    }
    ui.notify(`Wrote model: ${modelChoice} to ${path}.`, "info");
  }
}

/** A caught value's message, for an error notification. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
