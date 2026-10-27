import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "./agent-types.ts";
import { isLockableField, type LockDeclaration } from "./invocation-config.ts";
import { parseThinkingLevel, thinkingLevelError } from "./thinking-level.ts";
import { debugLog } from "../debug.ts";
import type { AgentConfig } from "../types.ts";

export function loadCustomAgents(cwd: string): Map<string, AgentConfig> {
  const globalDir = join(homedir(), ".agents", "agents");
  const projectDir = join(cwd, ".agents", "agents");

  const agents = new Map<string, AgentConfig>();
  loadFromDir(globalDir, agents, "global");
  loadFromDir(projectDir, agents, "project");
  return agents;
}

function loadFromDir(dir: string, agents: Map<string, AgentConfig>, source: "project" | "global"): void {
  if (!existsSync(dir)) return;

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".md"));
  } catch (err) {
    debugLog("readdirSync agents dir", err);
    return;
  }

  for (const file of files) {
    const name = basename(file, ".md");

    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch (err) {
      debugLog("readFileSync agent file", err);
      continue;
    }

    const { frontmatter: fm, body } = parseFrontmatter(content);

    agents.set(name, {
      name,
      displayName: str(fm.display_name),
      description: str(fm.description) ?? name,
      toolNames: listField(fm.tools, BUILTIN_TOOL_NAMES),
      model: str(fm.model),
      thinking: thinkingLevel(fm.thinking, name),
      maxTurns: nonNegativeInt(fm.max_turns),
      systemPrompt: body.trim(),
      promptMode: fm.prompt_mode === "replace" ? "replace" : "append",
      inheritContext: fm.inherit_context != null ? fm.inherit_context === true : undefined,
      locked: lockDeclaration(fm.locked, name),
      enabled: fm.enabled !== false,
      source,
    });
  }
}

function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function lockDeclaration(val: unknown, agentName: string): LockDeclaration | undefined {
  if (typeof val === "boolean") return val ? true : undefined;

  const entries = parseListField(val);
  if (entries === undefined) return undefined;

  const fields = entries.filter(isLockableField);
  const unknownEntries = entries.filter((entry) => !isLockableField(entry));
  if (unknownEntries.length > 0) {
    debugLog(`agent ${agentName} frontmatter locked`, `unknown fields: ${unknownEntries.join(", ")}`);
  }
  return fields.length > 0 ? fields : undefined;
}

function thinkingLevel(val: unknown, agentName: string): AgentConfig["thinking"] {
  const level = parseThinkingLevel(val);
  if (val != null && level === undefined) {
    debugLog(`agent ${agentName} frontmatter thinking`, thinkingLevelError(val));
  }
  return level;
}

function nonNegativeInt(val: unknown): number | undefined {
  return typeof val === "number" && val >= 0 ? val : undefined;
}

function parseListField(val: unknown): string[] | undefined {
  if (val === undefined || val === null) return undefined;
  const items = Array.isArray(val)
    ? val.map(entry => String(entry).trim()).filter(Boolean)

    : String(val).trim().split(",").map(entry => entry.trim()).filter(Boolean);
  if (items.length === 0) return undefined;
  return items.length === 1 && items[0] === "none" ? undefined : items;
}

function listField(val: unknown, defaults: string[]): string[] {
  if (val === undefined || val === null) return defaults;
  return parseListField(val) ?? [];
}
