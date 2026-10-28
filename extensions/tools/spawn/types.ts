import type { Model } from "@earendil-works/pi-ai";
import type { AgentSessionEvent, SessionContext as SdkSessionContext } from "@earendil-works/pi-coding-agent";
import type { SpawnThinkingLevel } from "./config/thinking-level.ts";
import type { ModelRegistry } from "./session/model-resolver.ts";

export { Spawn } from "./lifecycle/spawn.ts";
export type { AgentSessionEvent };

export type ThinkingLevel = SpawnThinkingLevel;

export type { PromptInheritance } from "../../../shared/settings.ts";

export type SessionMessage = SdkSessionContext["messages"][number];

export interface SubscribableSession {
  subscribe(fn: (event: AgentSessionEvent) => void): () => void;
}

export type SpawnType = string;

export interface AgentIdentity {
  name: string;
  displayName?: string;
  description: string;
  promptMode: "replace" | "append";
}

export interface AgentPromptConfig {
  name: string;
  promptMode: "replace" | "append";
  systemPrompt: string;
}

export interface AgentConfig extends AgentIdentity, AgentPromptConfig {

  toolNames?: string[];
  allTools?: boolean;
  model?: string;
  thinking?: ThinkingLevel;
  maxTurns?: number;

  inheritContext?: boolean;

  toolGuideline?: string;

  enabled?: boolean;

  source?: "global" | "project";
}

export interface AgentInvocation {
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext?: boolean;
}

export interface SessionContext {
  readonly cwd: string;
  readonly model: Model<any> | undefined;
  readonly modelRegistry: ModelRegistry;
  getSystemPrompt(): string;
  readonly sessionManager: {
    getSessionFile(): string | undefined;
    getSessionId(): string;
    getBranch(): unknown[];
  };
}

export type ShellExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>;

export interface ParentSessionInfo {

	parentSessionFile?: string;

	parentSessionId?: string;

	toolCallId?: string;
}

export type CompactionInfo = { reason: "manual" | "threshold" | "overflow"; tokensBefore: number };
