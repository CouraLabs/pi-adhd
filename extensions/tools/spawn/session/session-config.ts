import type { Model } from "@earendil-works/pi-ai";
import type { AgentConfigLookup } from "../config/agent-types.ts";
import type { EnvInfo } from "./env.ts";
import { resolveModel, type ModelRegistry } from "./model-resolver.ts";
import type { ProjectContextLoader } from "./project-context.ts";
import type { InheritedPrompt } from "./prompts.ts";
import type {
  AgentPromptConfig,
  PromptInheritance,
  SpawnType,
  ThinkingLevel,
} from "../types.ts";

export interface AssemblerIO {
  buildAgentPrompt: (
    config: AgentPromptConfig,
    cwd: string,
    env: EnvInfo,
    inherited?: InheritedPrompt,
    loadProjectContext?: ProjectContextLoader,
  ) => string;

  loadProjectContext: ProjectContextLoader;
}

export interface AssemblerContext {

  cwd: string;

  parentSystemPrompt: string;

  parentPortablePrompt?: string;

  resolvePromptInheritance?: (provider: string | undefined) => PromptInheritance;

  parentModel?: Model<any>;

  modelRegistry: ModelRegistry;
}

export interface AssemblerOptions {

  cwd?: string;

  model?: Model<any>;

  thinkingLevel?: ThinkingLevel;
}

export interface SessionConfig {

  effectiveCwd: string;

  systemPrompt: string;

  toolNames: string[];

  model: Model<any> | undefined;

  thinkingLevel: ThinkingLevel | undefined;

  agentMaxTurns: number | undefined;
}

function resolveDefaultModel(
  parentModel: Model<any> | undefined,
  registry: AssemblerContext["modelRegistry"],
  configModel?: string,
): Model<any> | undefined {
  if (!configModel) return parentModel;
  const resolved = resolveModel(configModel, registry);
  return typeof resolved === "string" ? parentModel : resolved;
}

export function assembleSessionConfig(
  type: SpawnType,
  ctx: AssemblerContext,
  options: AssemblerOptions,
  env: EnvInfo,
  registry: AgentConfigLookup,
  io: AssemblerIO,
): SessionConfig {
  const agentConfig = registry.resolveAgentConfig(type);

  const effectiveCwd = options.cwd ?? ctx.cwd;

  const toolNames = registry.getToolNamesForType(type);

  const model =
    options.model ??
    resolveDefaultModel(ctx.parentModel, ctx.modelRegistry, agentConfig.model);

  const systemPrompt = io.buildAgentPrompt(
    agentConfig,
    effectiveCwd,
    env,
    {
      systemPrompt: ctx.parentSystemPrompt,
      cwd: ctx.cwd,
      strategy: ctx.resolvePromptInheritance?.(model?.provider) ?? "full",
      portablePrompt: ctx.parentPortablePrompt,
    },
    io.loadProjectContext,
  );

  const thinkingLevel = options.thinkingLevel ?? agentConfig.thinking;

  const agentMaxTurns = agentConfig.maxTurns;

  return {
    effectiveCwd,
    systemPrompt,
    toolNames,
    model,
    thinkingLevel,
    agentMaxTurns,
  };
}
