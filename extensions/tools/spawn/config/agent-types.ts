/**
 * agent-types.ts — Unified agent type registry.
 *
 * Merges embedded default agents with user-defined agents from .agents/agents/*.md.
 * User agents override defaults with the same name. Disabled agents are kept but excluded from spawning.
 */

import { DEFAULT_AGENTS } from "./default-agents.ts";
import { parseThinkingLevel } from "./thinking-level.ts";
import { offloadPrompt, readUserPrompt } from "../../../../shared/user-prompts.ts";
import type { AgentConfig } from "../types.ts";

// ── Editable default-agent prompts ──────────────────────────────────────

/**
 * Offload a default agent's system prompt to the editable user folder and
 * read it back from there.
 *
 * The packaged prompt strings live inside the installed package, where a user
 * cannot reasonably edit them. On every registry build (spawn loading, or a
 * reload after custom agents change) each default prompt is copied once to
 * `~/.pi/couralabs/prompts/subagents/<name>.md` — an existing file is never
 * overwritten — and the config then reads that file, so edits on disk apply
 * after the next reload. Deleting the file restores the packaged version.
 * Agents with no system prompt (e.g. `general-purpose`) are left untouched.
 */
function withEditablePrompt(config: AgentConfig): AgentConfig {
	if (config.isDefault !== true || config.systemPrompt.length === 0) return config;
	offloadPrompt("subagents", `${config.name}.md`, config.systemPrompt);
	return { ...config, systemPrompt: readUserPrompt("subagents", `${config.name}.md`, config.systemPrompt) };
}

// ── AgentConfigLookup interface ──────────────────────────────────────────────

/**
 * Narrow registry interface for consumers that only need config resolution.
 * Prefer this over the full `AgentTypeRegistry` in function signatures (ISP).
 */
export interface AgentConfigLookup {
  resolveAgentConfig(type: string): AgentConfig;
  getToolNamesForType(type: string): string[];
}

// ── AgentTypeRegistry class ──────────────────────────────────────────────────

/**
 * Injectable registry of all agent configurations (defaults + user-defined).
 *
 * Replaces the module-scoped `agents` Map and its companion free functions.
 * The constructor accepts a `loadUserAgents` callback to defer disk I/O to the
 * call site, keeping this class side-effect-free and easy to test.
 */
export class AgentTypeRegistry implements AgentConfigLookup {
  private agents = new Map<string, AgentConfig>();

  constructor(
    private readonly loadUserAgents: () => Map<string, AgentConfig>,
    private readonly loadAgentModels: () => Record<string, string> = () => ({}),
    private readonly loadAgentThinking: () => Record<string, string> = () => ({}),
  ) {
    this.reload();
  }

  /**
   * Re-scan user agents and rebuild the registry.
   * Starts with DEFAULT_AGENTS, then overlays whatever `loadUserAgents()` returns.
   */
  reload(): void {
    this.agents.clear();
    for (const [name, config] of DEFAULT_AGENTS) {
      this.agents.set(name, withEditablePrompt(config));
    }
    for (const [name, config] of this.loadUserAgents()) {
      this.agents.set(name, config);
    }
  }

  /** Resolve a type name case-insensitively. Returns the canonical key or undefined. */
  resolveType(name: string): string | undefined {
    return this.resolveKey(name);
  }

  /** Get all enabled type names (for spawning and tool descriptions). */
  getAvailableTypes(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.enabled !== false)
      .map(([name]) => name);
  }

  /** Every config the registry knows, in insertion order (defaults first, then user agents). */
  list(): AgentConfig[] {
    return [...this.agents.values()];
  }

  /** Get names of default agents currently in the registry. */
  getDefaultAgentNames(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.isDefault === true)
      .map(([name]) => name);
  }

  /** Get names of user-defined agents (non-defaults) currently in the registry. */
  getUserAgentNames(): string[] {
    return [...this.agents.entries()]
      .filter(([_, config]) => config.isDefault !== true)
      .map(([name]) => name);
  }

  /** Check if a type is valid and enabled (case-insensitive). */
  isValidType(type: string): boolean {
    const key = this.resolveKey(type);
    if (!key) return false;
    return this.agents.get(key)?.enabled !== false;
  }

  /**
   * Get the capability tool names for a type (case-insensitive).
   *
   * An agent that declares no `tools:` key gets the built-ins; one that declares
   * `tools: none` gets nothing. Resolution goes through `resolveAgentConfig` so
   * the two cannot disagree about which config a type names.
   */
  getToolNamesForType(type: string): string[] {
    return this.resolveAgentConfig(type).toolNames ?? [...BUILTIN_TOOL_NAMES];
  }

  /** Resolve agent config with guaranteed non-null return. Falls back: unknown → general-purpose → absolute fallback. */
  resolveAgentConfig(type: string): AgentConfig {
    const key = this.resolveKey(type);
    const config = key ? this.agents.get(key) : undefined;
    if (config) {
      // Apply the settings overrides only when the agent has no file of its own.
      // The settings maps exist only because built-ins have no markdown to edit;
      // a custom agent's frontmatter `model:`/`thinking:` is the more specific
      // source and must win. Returns a shallow copy — `reload()` inserts the
      // DEFAULT_AGENTS config objects by reference, so never mutate them.
      const overrides = this.loadAgentModels()[config.name];
      const thinkingOverride = parseThinkingLevel(this.loadAgentThinking()[config.name]);
      if (
        (overrides !== undefined || thinkingOverride !== undefined) &&
        (config.source === undefined || config.source === "default")
      ) {
        return {
          ...config,
          ...(overrides !== undefined ? { model: overrides } : {}),
          ...(thinkingOverride !== undefined ? { thinking: thinkingOverride } : {}),
        };
      }
      return config;
    }

    const gp = this.agents.get("general-purpose");
    if (gp) return gp;

    // Absolute fallback (should never happen in practice)
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

/** All known built-in tool names. */
export const BUILTIN_TOOL_NAMES: string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
