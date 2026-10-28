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
import { globalAgentsDir } from "./config/agent-dirs.ts";
import { loadAgentDefinitions } from "./config/custom-agents.ts";
import { resolveConfiguredDefaultModel } from "./config/default-model.ts";
import { provisionDefaultAgents } from "./config/seed-agents.ts";
import { loadPackagedSeedAgents } from "./config/seed-source.ts";
import { debugLog } from "./debug.ts";
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
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { getUserPromptsDir } from "../../../shared/user-prompts.ts";
import { createExcludedPackagesStorage } from "./session/package-exclusions.ts";
import { createProjectContextLoader } from "./session/project-context.ts";
import { buildAgentPrompt } from "./session/prompts.ts";
import { inheritRegisteredProviders } from "./session/provider-inheritance.ts";
import { deriveSpawnSessionDir } from "./session/session-dir.ts";
import { SettingsManager } from "./settings.ts";
import { AgentTool } from "./tools/agent-tool.ts";
import { SessionNavigatorHandler } from "./ui/session-navigator.ts";
import { SpawnSettingsHandler } from "./ui/spawn-settings.ts";

export default function (pi: ExtensionAPI) {
  markExtensionLoaded("spawn");

  try {
    provisionDefaultAgents(globalAgentsDir(), loadPackagedSeedAgents(), join(getUserPromptsDir(), "subagents"));
  } catch (err) {
    debugLog("provisionDefaultAgents", err);
  }

  const runtime = createSpawnRuntime();

  const settings = new SettingsManager({
    emit: (event, payload) => pi.events.emit(event, payload),
  });
  settings.load();

  const registry = new AgentTypeRegistry(() => loadAgentDefinitions(process.cwd()));

  const eventsObserver = new SpawnEventsObserver({
    emit: (channel, data) => pi.events.emit(channel, data),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
  });

  const observer = new CompositeSpawnObserver([eventsObserver]);

  const spawnSessionDeps: SpawnSessionDeps = {
    io: {
      detectEnv,
      getAgentDir,
      createResourceLoader: (opts) => new DefaultResourceLoader(opts),
      deriveSessionDir: deriveSpawnSessionDir,
      createSessionManager: (cwd, dir) => SessionManager.create(cwd, dir),
      createSettingsManager: (cwd, dir) => SdkSettingsManager.create(cwd, dir),

      createLoaderSettingsManager: (parent) => {
        const excluded = new Set(settings.excludedExtensionPackages);
        if (excluded.size === 0) return parent;
        return SdkSettingsManager.fromStorage(createExcludedPackagesStorage(parent, excluded), {
          projectTrusted: parent.isProjectTrusted(),
        });
      },

      createSession: async ({ sessionManager, resourceLoader, modelRegistry, ...rest }) => {

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

        loadProjectContext: createProjectContextLoader(
          loadProjectContextFiles,
          getAgentDir(),
        ),
      },
    },
    exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
    registry,
    lifecycle: createChildLifecyclePublisher((channel, data) => pi.events.emit(channel, data)),

    resolvePromptInheritance: (provider) => settings.promptInheritanceFor(provider),

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

  const service = new SpawnServiceAdapter(manager);

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,

    () => {
      const sessionId = runtime.currentCtx?.sessionManager.getSessionId();
      if (!isChildSession(sessionId)) unpublishSpawnService();
    },
  );

  const SPAWN_TOOL_NAMES: readonly string[] = ["spawn"];
  let spawnEnabled = true;
  const SPAWN_CHILD_MESSAGE = "pi-adhd spawn is unavailable inside a spawned child session";

  const setSpawnToolsActive = (active: boolean): void => {
    const current = pi.getActiveTools();
    if (active) {
      pi.setActiveTools([...new Set([...current, ...SPAWN_TOOL_NAMES])]);
    } else {
      pi.setActiveTools(current.filter((name) => !SPAWN_TOOL_NAMES.includes(name)));
    }
  };

  const applySpawnEnabled = (isChild: boolean): void => {

    if (isChild) {
      setSpawnToolsActive(false);
      return;
    }
    setSpawnToolsActive(spawnEnabled);
  };

  pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
  pi.on("session_start", (_event, ctx) => {
    const isChild = isChildSession(ctx.sessionManager.getSessionId());
    spawnEnabled = !isChild;
    applySpawnEnabled(isChild);

    if (!isChild) {
      publishSpawnService(service);
      runtime.setDefaultModelRef(resolveConfiguredDefaultModel(ctx.cwd));
    }
  });
  pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());

  pi.on("before_agent_start", (event) => {
    runtime.setSystemPromptOptions(event.systemPromptOptions);
  });

  pi.registerTool(new AgentTool(manager, runtime, settings, registry).toToolDefinition());

  const spawnSettings = new SpawnSettingsHandler(settings);

  pi.registerCommand("spawn:settings", {
    description: "Configure pi-adhd spawn (turn limits, retention)",
    handler: async (_args, ctx) => {
      if (!spawnEnabled) {
        ctx.ui.notify(SPAWN_CHILD_MESSAGE, "warning");
        return;
      }
      await spawnSettings.handle({ ui: ctx.ui });
    },
  });

  const sessionNavigator = new SessionNavigatorHandler();

  pi.registerCommand("spawn:sessions", {
    description: "View a spawned agent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      if (!spawnEnabled) {
        ctx.ui.notify(SPAWN_CHILD_MESSAGE, "warning");
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

}
