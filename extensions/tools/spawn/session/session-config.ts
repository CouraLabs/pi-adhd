/**
 * session-config.ts — Pure configuration assembler for agent sessions.
 *
 * `assembleSessionConfig()` is the pure assembly core called by
 * `createSpawnSession()`. It accepts resolved inputs (agent type, narrow
 * context, run options, env info) and returns everything the factory needs to
 * create the SDK session — without importing or constructing any Pi SDK types.
 *
 * The only async IO in the assembly phase (`detectEnv`) is handled by the caller
 * before invoking this function, keeping the assembler synchronous.
 */

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

// ── Public interfaces ────────────────────────────────────────────────────────

/**
 * IO collaborators injected into `assembleSessionConfig`.
 *
 * Bundling the IO-touching (or promptly testable) function into a single
 * interface keeps the assembler free of direct module imports and makes it
 * trivially testable without `vi.mock()` — callers inject real implementations
 * at the edge (`create-spawn-session.ts`) or stubs in tests.
 */
export interface AssemblerIO {
  buildAgentPrompt: (
    config: AgentPromptConfig,
    cwd: string,
    env: EnvInfo,
    inherited?: InheritedPrompt,
    loadProjectContext?: ProjectContextLoader,
  ) => string;
  /**
   * Resolves a directory's project instructions. Relayed to the prompt builder,
   * which decides whether this child needs its own — the assembler never calls
   * it, so a child that inherits an accurate block does no file IO.
   */
  loadProjectContext: ProjectContextLoader;
}

/**
 * Narrow context the assembler reads from the parent session.
 * Tests construct plain objects satisfying this interface — no SDK mocking needed.
 *
 * The assembler never inspects model internals, only passes them through;
 * `resolveDefaultModel` reads `provider`/`id` from `getAvailable()` for the
 * availability check.
 */
export interface AssemblerContext {
  /** Parent working directory (overridable via options.cwd). */
  cwd: string;
  /** Parent's effective system prompt (for append-mode agents). */
  parentSystemPrompt: string;
  /** Parent's operator-authored parts, for a child on a re-homing provider. */
  parentPortablePrompt?: string;
  /**
   * Which prompt-inheritance strategy the child's provider calls for.
   * Absent resolves every child to `"full"`.
   */
  resolvePromptInheritance?: (provider: string | undefined) => PromptInheritance;
  /** Parent's current model instance (fallback when agent config has no model). */
  parentModel?: Model<any>;
  /** Model registry for resolving config.model strings. */
  modelRegistry: ModelRegistry;
}

/**
 * Narrow slice of per-spawn execution fields consumed by the assembler.
 * All fields are optional — callers pass only what they have.
 */
export interface AssemblerOptions {
  /** Override working directory (e.g. for worktree isolation). */
  cwd?: string;
  /** Explicit model override — wins over agentConfig.model and parent model. */
  model?: Model<any>;
  /** Explicit thinking level — wins over agentConfig.thinking. */
  thinkingLevel?: ThinkingLevel;
}

/**
 * Assembled configuration returned to `createSpawnSession()`.
 * Contains everything needed to create the SDK session and filter tools —
 * with no SDK object references.
 */
export interface SessionConfig {
  /** Resolved working directory (`options.cwd ?? ctx.cwd`). */
  effectiveCwd: string;
  /** Fully-assembled system prompt string (ready for `systemPromptOverride`). */
  systemPrompt: string;
  /** Built-in tool name allowlist for this agent type. */
  toolNames: string[];
  /**
   * Resolved model instance (undefined → use parent model as passed to SDK).
   * The assembler passes it through without inspection.
   */
  model: Model<any> | undefined;
  /** Resolved thinking level (undefined → inherit from session). */
  thinkingLevel: ThinkingLevel | undefined;
  /** Per-agent configured max turns (from agentConfig.maxTurns). */
  agentMaxTurns: number | undefined;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the default model from the agent config's model string.
 *
 * Delegates to the shared `resolveModel` — exact `provider/modelId` match
 * against the full registry, then fuzzy match against available models — so
 * both resolution paths accept the same strings. `parentModel` remains the
 * fallback when the string resolves to nothing.
 */
function resolveDefaultModel(
  parentModel: Model<any> | undefined,
  registry: AssemblerContext["modelRegistry"],
  configModel?: string,
): Model<any> | undefined {
  if (!configModel) return parentModel;
  const resolved = resolveModel(configModel, registry);
  return typeof resolved === "string" ? parentModel : resolved;
}

// ── Public function ──────────────────────────────────────────────────────────

/**
 * Assemble all configuration needed to create an agent session.
 *
 * Synchronous and side-effect-free — all IO is delegated through the `io`
 * parameter. The caller is responsible for resolving `EnvInfo` beforehand
 * via `detectEnv()`.
 *
 * @param type       The spawn type name (case-insensitive registry lookup).
 * @param ctx        Narrow context from the parent session.
 * @param options    Per-call overrides (cwd, model, thinkingLevel).
 * @param env        Pre-resolved environment info from `detectEnv()`.
 * @param registry   Agent config lookup — provides resolveAgentConfig and getToolNamesForType.
 * @param io         IO collaborators (skill loader, memory builder, prompt builder).
 */
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

  // Model resolution: explicit option > config model string > parent model.
  // Resolved before the prompt because the child's provider is what selects a
  // prompt-inheritance strategy; the two computations are otherwise
  // independent, so the order is free.
  const model =
    options.model ??
    resolveDefaultModel(ctx.parentModel, ctx.modelRegistry, agentConfig.model);

  // Build system prompt from the resolved agent config. The strategy is keyed
  // on the child's own provider, so a per-spawn model override moves the child
  // between transports and takes the right strategy with it.
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

  // Thinking level: explicit option > agent config > undefined (inherit)
  const thinkingLevel = options.thinkingLevel ?? agentConfig.thinking;

  // Per-agent max turns (combined with per-call maxTurns and defaultMaxTurns by SpawnSession.runTurnLoop)
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
