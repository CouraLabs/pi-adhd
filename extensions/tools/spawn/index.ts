/**
 * spawn — A pi extension providing focused, in-process autonomous agents.
 *
 * Tools:
 *   Spawn — LLM-callable: spawn an agent
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  getAgentDir,
  loadProjectContextFiles,
  ModelRuntime,
  type ResourceLoader,
  ModelRegistry as SdkModelRegistry,
  SettingsManager as SdkSettingsManager,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { AgentTypeRegistry } from "./config/agent-types.ts";
import { loadCustomAgents } from "./config/custom-agents.ts";
import { SessionLifecycleHandler } from "./handlers/index.ts";
import { createChildLifecyclePublisher } from "./lifecycle/child-lifecycle.ts";
import { createSpawnSession, type SpawnSessionDeps } from "./lifecycle/create-spawn-session.ts";
import { SpawnManager } from "./lifecycle/spawn-manager.ts";
import { CompositeSpawnObserver } from "./observation/composite-spawn-observer.ts";
import { SpawnEventsObserver } from "./observation/spawn-events-observer.ts";
import { createSpawnRuntime } from "./runtime.ts";
import { publishSpawnService, unpublishSpawnService } from "./service/service.ts";
import { SpawnServiceAdapter } from "./service/service-adapter.ts";
import { detectEnv } from "./session/env.ts";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { createExcludedPackagesStorage } from "./session/package-exclusions.ts";
import { createProjectContextLoader } from "./session/project-context.ts";
import { buildAgentPrompt } from "./session/prompts.ts";
import { inheritRegisteredProviders } from "./session/provider-inheritance.ts";
import { deriveSpawnSessionDir } from "./session/session-dir.ts";
import { SettingsManager } from "./settings.ts";
import { AgentTool } from "./tools/agent-tool.ts";
import { SessionNavigatorHandler } from "./ui/session-navigator.ts";
import { SpawnDefaultsHandler } from "./ui/spawn-defaults.ts";
import { SpawnSettingsHandler } from "./ui/spawn-settings.ts";
import { loadSettings, updateSettings } from "../../../shared/settings.ts";

export default function (pi: ExtensionAPI) {

  const registry = new AgentTypeRegistry(
    () => loadCustomAgents(process.cwd()),
    () => settings.agentModels,
  );

  // ---- Runtime: all mutable extension state in one place ----
  const runtime = createSpawnRuntime();

  // Settings: owns all in-memory values and handles load/save/emit.
  const settings = new SettingsManager({
    emit: (event, payload) => pi.events.emit(event, payload),
  });
  settings.load();

  // Observer: receives agent lifecycle notifications and dispatches events/session entries.
  const eventsObserver = new SpawnEventsObserver({
    emit: (channel, data) => pi.events.emit(channel, data),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
  });

  // Fan-out observer: lets additional lifecycle consumers subscribe while the
  // manager keeps its single-observer contract. Delegates can be added after
  // construction; the manager consults the observer only at spawn time, so
  // registering late is safe.
  const observer = new CompositeSpawnObserver([eventsObserver]);

  const spawnSessionDeps: SpawnSessionDeps = {
    io: {
      detectEnv,
      getAgentDir,
      createResourceLoader: (opts) => new DefaultResourceLoader(opts),
      deriveSessionDir: deriveSpawnSessionDir,
      createSessionManager: (cwd, dir) => SessionManager.create(cwd, dir),
      createSettingsManager: (cwd, dir) => SdkSettingsManager.create(cwd, dir),
      // The exclusion policy is resolved here, at the composition root, so the
      // assembly factory stays free of it and gets a ready-made settings view.
      createLoaderSettingsManager: (parent) => {
        const excluded = new Set(settings.excludedExtensionPackages);
        if (excluded.size === 0) return parent;
        return SdkSettingsManager.fromStorage(createExcludedPackagesStorage(parent, excluded), {
          projectTrusted: parent.isProjectTrusted(),
        });
      },
      // The factory states its collaborators as narrow structural contracts so
      // it can be tested with plain stubs. Here at the composition root the
      // values really are the SDK objects, so widen those three and let every
      // other option type-check against the SDK signature.
      createSession: async ({ sessionManager, resourceLoader, modelRegistry, ...rest }) => {
        // Pi builds the child a fresh ModelRuntime whenever it is not given
        // one, and runtime registrations live on the instance rather than in
        // models.json or auth.json — so the child would lose every provider the
        // parent registered via pi.registerProvider. Build the runtime here
        // instead and replay those registrations onto it. The child keeps its
        // own pool, so a child-loaded extension cannot mutate the parent's
        // (Refs #812). The path derivation mirrors the SDK's own.
        const childRuntime = await ModelRuntime.create({
          authPath: join(rest.agentDir, "auth.json"),
          modelsPath: join(rest.agentDir, "models.json"),
        });
        const childRegistry = new SdkModelRegistry(childRuntime);
        inheritRegisteredProviders(modelRegistry as SdkModelRegistry, {
          registerNative: (provider) => {
            childRegistry.registerProvider(provider);
          },
          registerConfigured: (id, config) => {
            childRegistry.registerProvider(id, config);
          },
        });
        return createAgentSession({
          ...rest,
          sessionManager: sessionManager as SessionManager,
          resourceLoader: resourceLoader as ResourceLoader,
          modelRuntime: childRuntime,
        });
      },
      assemblerIO: {
        buildAgentPrompt,
        // Pi's own discovery, pointed at whichever directory the child runs in.
        loadProjectContext: createProjectContextLoader(
          loadProjectContextFiles,
          getAgentDir(),
        ),
      },
    },
    exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
    registry,
    lifecycle: createChildLifecyclePublisher((channel, data) => pi.events.emit(channel, data)),
    // Resolved here, at the composition root, so the assembly factory stays
    // free of the policy and gets a ready-made settings view — the same shape
    // the extension-exclusion policy reaches it in. It is a resolver rather
    // than a value because only the assembler knows the child's provider.
    resolvePromptInheritance: (provider) => settings.promptInheritanceFor(provider),
    // Read per child rather than once: an MCP server connects in the
    // background, so its tools register after this extension loads.
    listParentToolNames: () => pi.getAllTools().map((tool) => tool.name),
  };

  const manager = new SpawnManager({
    createSpawnSession: (params) => createSpawnSession(params, spawnSessionDeps),
    baseCwd: process.cwd(),
    observer,
    getRunConfig: () => settings,
    getRetentionPolicy: () => settings,
    registry,
  });

  // Typed service published via Symbol.for() for cross-extension access.
  // Consumers: const { getSpawnService } = await import("@couralabs/pi-tdah/shared/spawn-service.ts");
  const service = new SpawnServiceAdapter(manager);
  publishSpawnService(service);

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,
    // A child shares the process-global service slot with its parent, so
    // unpublishing there would strip the parent's service. Only the parent
    // (never a child) unpublishes. `currentCtx` is still set here — the handler
    // unpublishes before it clears the session context.
    () => {
      const sessionId = runtime.currentCtx?.sessionManager.getSessionId();
      if (!isChildSession(sessionId)) unpublishSpawnService();
    },
  );

  // ---- pi-tdah enable/disable toggle ----
  // Tools stay registered so the command can re-arm them; enabling/disabling
  // only changes the active tool set (what the model is offered). The choice
  // persists in `~/.pi/couralabs/settings.json`.
  const SPAWN_TOOL_NAMES: readonly string[] = ["spawn"];
  let spawnEnabled = true;

  const setSpawnToolsActive = (active: boolean): void => {
    const current = pi.getActiveTools();
    if (active) {
      pi.setActiveTools([...new Set([...current, ...SPAWN_TOOL_NAMES])]);
    } else {
      pi.setActiveTools(current.filter((name) => !SPAWN_TOOL_NAMES.includes(name)));
    }
  };

  const applySpawnEnabled = (isChild: boolean): void => {
    // A spawned agent must never be offered the spawn tools, whatever the operator
    // set in the parent: the child's own copy of this extension would otherwise
    // re-activate them in session_start, bypassing the SDK excludeTools denylist
    // (`setActiveTools()` re-checks the allowlist but not the denylist).
    if (isChild) {
      setSpawnToolsActive(false);
      return;
    }
    setSpawnToolsActive(spawnEnabled);
  };

  pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
  pi.on("session_start", (_event, ctx) => {
    const isChild = isChildSession(ctx.sessionManager.getSessionId());
    spawnEnabled = isChild ? false : loadSettings().spawn.enabled;
    applySpawnEnabled(isChild);
  });
  pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());

  // Capture the prompt parts Pi assembled for the parent's turn. This is the
  // only event carrying them — `getSystemPromptOptions()` is attached to a
  // command context, not to the session context the runtime holds — and a spawn
  // renders the parent's portable identity from the latest capture.
  pi.on("before_agent_start", (event) => {
    runtime.setSystemPromptOptions(event.systemPromptOptions);
  });

  // ---- Agent tool ----

  pi.registerTool(new AgentTool(manager, runtime, settings, registry).toToolDefinition());

  // ---- /spawn command ----

  pi.registerCommand("spawn", {
    description: "Toggle pi-tdah spawn and their tools (usage: /spawn [on|off])",
    handler: async (args, ctx) => {
      if (isChildSession(ctx.sessionManager.getSessionId())) {
        ctx.ui.notify("Spawn cannot be enabled inside a spawned child session", "warning");
        return;
      }
      const arg = args.trim().toLowerCase();
      if (arg === "on") spawnEnabled = true;
      else if (arg === "off") spawnEnabled = false;
      else spawnEnabled = !spawnEnabled;

      updateSettings({ spawn: { enabled: spawnEnabled } });
      applySpawnEnabled(false);
      ctx.ui.notify(
        spawnEnabled
          ? "pi-tdah spawn enabled"
          : "pi-tdah spawn disabled — tools hidden",
        "info",
      );
    },
  });

  // ---- /spawn:settings command ----

  const spawnSettings = new SpawnSettingsHandler(settings);

  pi.registerCommand("spawn:settings", {
    description: "Configure pi-tdah spawn (turn limits, retention)",
    handler: async (_args, ctx) => {
      if (!spawnEnabled) {
        ctx.ui.notify("pi-tdah spawn is disabled — run /spawn on", "warning");
        return;
      }
      await spawnSettings.handle({ ui: ctx.ui });
    },
  });

  // ---- /spawn:sessions command ----

  const sessionNavigator = new SessionNavigatorHandler();

  pi.registerCommand("spawn:sessions", {
    description: "View a spawned agent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      if (!spawnEnabled) {
        ctx.ui.notify("pi-tdah spawn is disabled — run /spawn on", "warning");
        return;
      }
      await sessionNavigator.handle({
        ui: ctx.ui,
        agents: manager.listAgents(),
        registry,
        cwd: ctx.cwd,
        readFile: (path) => readFileSync(path, "utf8"),
        sessionEntries: ctx.sessionManager.getEntries(),
      });
    },
  });

  // ---- /spawn:model command ----

  const spawnDefaultsHandler = new SpawnDefaultsHandler();

  pi.registerCommand("spawn:model", {
    description: "Set a spawned agent's default model and thinking level (built-in or .agents/agents/*.md)",
    handler: async (_args, ctx) => {
      if (!spawnEnabled) {
        ctx.ui.notify("pi-tdah spawn is disabled — run /spawn on", "warning");
        return;
      }
      await spawnDefaultsHandler.handle({
        ui: ctx.ui,
        listAgents: () => registry.list(),
        cwd: ctx.cwd,
        models:
          ctx.scopedModels.length > 0
            ? ctx.scopedModels.map((scoped) => scoped.model)
            : ctx.modelRegistry.getAvailable(),
        getBuiltInModels: () => settings.agentModels,
        getBuiltInThinking: () => settings.agentThinking,
        setAgentModel: (agentName, modelId) => settings.applyAgentModel(agentName, modelId),
        setAgentThinking: (agentName, thinking) => settings.applyAgentThinking(agentName, thinking),
        reload: () => registry.reload(),
      });
    },
  });

}
