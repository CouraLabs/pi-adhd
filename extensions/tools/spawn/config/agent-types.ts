import { DEFAULT_AGENTS } from "./default-agents.ts";
import { offloadPrompt, readUserPrompt } from "../../../../shared/user-prompts.ts";
import type { AgentConfig } from "../types.ts";

const DEFAULT_AGENT_NAMES = new Set(DEFAULT_AGENTS.keys());

function withEditablePrompt(config: AgentConfig): AgentConfig {
	if (!DEFAULT_AGENT_NAMES.has(config.name) || config.systemPrompt.length === 0) return config;
	offloadPrompt("subagents", `${config.name}.md`, config.systemPrompt);
	return { ...config, systemPrompt: readUserPrompt("subagents", `${config.name}.md`, config.systemPrompt) };
}

export interface AgentConfigLookup {
  resolveAgentConfig(type: string): AgentConfig;
  getToolNamesForType(type: string): string[];
}

export class AgentTypeRegistry implements AgentConfigLookup {
  private agents = new Map<string, AgentConfig>();
  private userAgentNames = new Set<string>();

  constructor(private readonly loadUserAgents: () => Map<string, AgentConfig>) {
    this.reload();
  }

  reload(): void {
    this.agents.clear();
    this.userAgentNames.clear();
    for (const [name, config] of DEFAULT_AGENTS) {
      this.agents.set(name, withEditablePrompt(config));
    }
    for (const [name, config] of this.loadUserAgents()) {
      this.userAgentNames.add(name);
      this.agents.set(name, config);
    }
  }

  resolveType(name: string): string | undefined {
    return this.resolveKey(name);
  }

  getAvailableTypes(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.enabled !== false)
      .map(([name]) => name);
  }

  list(): AgentConfig[] {
    return [...this.agents.values()];
  }

  getDefaultAgentNames(): string[] {
    return [...this.agents.keys()].filter(
      (name) => DEFAULT_AGENT_NAMES.has(name) && !this.userAgentNames.has(name),
    );
  }

  getUserAgentNames(): string[] {
    return [...this.agents.keys()].filter(
      (name) => !DEFAULT_AGENT_NAMES.has(name) || this.userAgentNames.has(name),
    );
  }

  isValidType(type: string): boolean {
    const key = this.resolveKey(type);
    if (!key) return false;
    return this.agents.get(key)?.enabled !== false;
  }

  getToolNamesForType(type: string): string[] {
    return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];
  }

  resolveAgentConfig(type: string): AgentConfig {
    const key = this.resolveKey(type);
    const config = key ? this.agents.get(key) : undefined;
    if (config) {
      return config;
    }

    const gp = this.agents.get("general-purpose");
    if (gp) return gp;

    return {
      name: type,
      displayName: "Agent",
      description: "General-purpose agent for complex, multi-step tasks",
      toolNames: BUILTIN_TOOL_NAMES,
      systemPrompt: "",
      promptMode: "append",
    };
  }

  private resolveKey(name: string): string | undefined {
    if (this.agents.has(name)) return name;
    const lower = name.toLowerCase();
    for (const key of this.agents.keys()) {
      if (key.toLowerCase() === lower) return key;
    }
    return undefined;
  }
}

export const BUILTIN_TOOL_NAMES: string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
