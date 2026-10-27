import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type InlineExtension,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "../config/agent-types.ts";
import { debugNote } from "../debug.ts";
import type { ChildLifecyclePublisher } from "./child-lifecycle.ts";
import type { ParentSnapshot } from "./parent-snapshot.ts";
import { SpawnSession } from "./spawn-session.ts";
import { AskParentTool, type QuestionRecorder } from "../session/ask-parent-tool.ts";
import { builtinExtensionsFor } from "../session/builtin-extensions.ts";
import { registerChildSession } from "../../../../shared/child-sessions.ts";
import type { EnvInfo } from "../session/env.ts";
import { expandMcpToolPatterns } from "../session/mcp-tool-patterns.ts";
import type { ModelRegistry } from "../session/model-resolver.ts";
import { type AssemblerIO, assembleSessionConfig } from "../session/session-config.ts";
import type {
  ParentSessionInfo,
  PromptInheritance,
  ShellExec,
  SpawnType,
  ThinkingLevel,
} from "../types.ts";

const EXCLUDED_TOOL_NAMES = ["spawn", "job", "job-kill", "job-read", "job-list"];

export interface ResourceLoaderLike {
  reload(): Promise<void>;
}

export interface SessionManagerLike {
  newSession(opts: { parentSession?: string }): void;
  getSessionFile(): string | undefined;
  getSessionId(): string;
}

export interface ResourceLoaderOptions {
  cwd: string;
  agentDir: string;

  settingsManager?: SettingsManager;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  noContextFiles?: boolean;
  systemPromptOverride?: () => string;

  appendSystemPromptOverride?: (base: string[]) => string[];

  extensionFactories?: InlineExtension[];
}

export interface CreateSessionOptions {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManagerLike;
  settingsManager: SettingsManager;
  modelRegistry: ModelRegistry;
  model?: Model<any>;

  tools: string[];

  customTools?: ToolDefinition[];

  excludeTools?: string[];
  resourceLoader: ResourceLoaderLike;
  thinkingLevel?: ThinkingLevel;
}

export interface EnvironmentIO {
  detectEnv: (exec: ShellExec, cwd: string) => Promise<EnvInfo>;
  getAgentDir: () => string;
  deriveSessionDir: (parentSessionFile: string | undefined, effectiveCwd: string) => string;
}

export interface SessionFactoryIO {
  createResourceLoader: (opts: ResourceLoaderOptions) => ResourceLoaderLike;
  createSessionManager: (cwd: string, sessionDir: string) => SessionManagerLike;
  createSettingsManager: (cwd: string, agentDir: string) => SettingsManager;

  createLoaderSettingsManager: (parent: SettingsManager) => SettingsManager;
  createSession: (opts: CreateSessionOptions) => Promise<{ session: AgentSession }>;
  assemblerIO: AssemblerIO;
}

export type SpawnSessionIO = EnvironmentIO & SessionFactoryIO;

export interface SpawnSessionDeps {
  io: SpawnSessionIO;
  exec: ShellExec;
  registry: AgentConfigLookup;

  lifecycle: ChildLifecyclePublisher;

  resolvePromptInheritance: (provider: string | undefined) => PromptInheritance;

  listParentToolNames: () => readonly string[];
}

export interface CreateSpawnSessionParams {
  snapshot: ParentSnapshot;
  type: SpawnType;

  cwd?: string;

  parentSession?: ParentSessionInfo;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;

  askParent?: QuestionRecorder;
}

function buildChildTools(params: CreateSpawnSessionParams): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (params.askParent) tools.push(new AskParentTool(params.askParent).toToolDefinition());
  return tools;
}

export async function createSpawnSession(
  params: CreateSpawnSessionParams,
  deps: SpawnSessionDeps,
): Promise<SpawnSession> {
  const { snapshot, type } = params;
  const parentSessionId = params.parentSession?.parentSessionId;
  deps.lifecycle.spawning({ agentName: type, parentSessionId });

  const effectiveCwd = params.cwd ?? snapshot.cwd;
  const env = await deps.io.detectEnv(deps.exec, effectiveCwd);

  const cfg = assembleSessionConfig(
    type,
    {
      cwd: snapshot.cwd,
      parentSystemPrompt: snapshot.systemPrompt,
      parentPortablePrompt: snapshot.portablePrompt,
      parentModel: snapshot.model,
      parentToolNames: deps.listParentToolNames(),
      resolvePromptInheritance: deps.resolvePromptInheritance,
    },
    {
      cwd: params.cwd,
      model: params.model,
      thinkingLevel: params.thinkingLevel,
    },
    env,
    deps.registry,
    deps.io.assemblerIO,
  );

  const { toolNames, unmatchedPatterns } = expandMcpToolPatterns(
    cfg.toolNames,
    deps.listParentToolNames(),
  );
  for (const pattern of unmatchedPatterns) {
    debugNote(`agent ${type}: tools pattern ${pattern} matched no tool the parent has`);
  }

  const agentDir = deps.io.getAgentDir();
  const sessionSettings = deps.io.createSettingsManager(cfg.effectiveCwd, agentDir);
  const loaderSettings = deps.io.createLoaderSettingsManager(sessionSettings);

  const loader = deps.io.createResourceLoader({
    cwd: cfg.effectiveCwd,
    agentDir,
    settingsManager: loaderSettings,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => cfg.systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: builtinExtensionsFor(toolNames),
  });
  await loader.reload();

  const sessionDir = deps.io.deriveSessionDir(params.parentSession?.parentSessionFile, cfg.effectiveCwd);
  const sessionManager = deps.io.createSessionManager(cfg.effectiveCwd, sessionDir);
  sessionManager.newSession({ parentSession: params.parentSession?.parentSessionId });
  const sessionId = sessionManager.getSessionId();

  registerChildSession(sessionId);

  const childTools = buildChildTools(params);
  const { session } = await deps.io.createSession({
    cwd: cfg.effectiveCwd,
    agentDir,
    sessionManager,
    settingsManager: sessionSettings,
    modelRegistry: snapshot.modelRegistry,
    model: cfg.model,
    tools: [...toolNames, ...childTools.map((tool) => tool.name)],
    customTools: childTools,
    excludeTools: EXCLUDED_TOOL_NAMES,
    resourceLoader: loader,
    thinkingLevel: cfg.thinkingLevel,
  });

  const spawnSession = new SpawnSession(session, {
    outputFile: sessionManager.getSessionFile(),
    sessionId,
    sessionDir,
    agentName: type,
    agentMaxTurns: cfg.agentMaxTurns,
    parentContext: snapshot.parentContext,
    lifecycle: deps.lifecycle,
  });

  deps.lifecycle.sessionCreated({ sessionId, parentSessionId });

  try {

    await session.bindExtensions({});
  } catch (err) {

    await spawnSession.dispose();
    throw err;
  }

  deps.lifecycle.bound({ sessionId, parentSessionId });

  return spawnSession;
}
