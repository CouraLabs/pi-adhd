/**
 * pi-agents — A pi extension providing focused, in-process autonomous sub-agents.
 *
 * Tools:
 *   Agent             — LLM-callable: spawn a sub-agent
 *   get_subagent_result  — LLM-callable: check background agent status/result
 *   steer_subagent       — LLM-callable: send a steering message to a running agent
 *
 * Commands:
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
import { registerDelegateCommands } from "./commands/delegate.ts";
import { InterruptHandler, SessionLifecycleHandler, WidgetEventsHandler } from "./handlers/index.ts";
import { createChildLifecyclePublisher } from "./lifecycle/child-lifecycle.ts";
import { ConcurrencyLimiter } from "./lifecycle/concurrency-limiter.ts";
import { createSubagentSession, type SubagentSessionDeps } from "./lifecycle/create-subagent-session.ts";
import { SubagentManager } from "./lifecycle/subagent-manager.ts";
import { CompositeSubagentObserver } from "./observation/composite-subagent-observer.ts";
import {
  type NotificationDetails,
  NotificationManager,
  type UpdateDetails,
  type WorkspaceNoticeDetails,
} from "./observation/notification.ts";
import { SubagentEventsObserver } from "./observation/subagent-events-observer.ts";
import { createSubagentRuntime } from "./runtime.ts";
import { publishSubagentsService, unpublishSubagentsService } from "./service/service.ts";
import { SubagentsServiceAdapter } from "./service/service-adapter.ts";
import { detectEnv } from "./session/env.ts";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { resolveModel } from "./session/model-resolver.ts";
import { createExcludedPackagesStorage } from "./session/package-exclusions.ts";
import { createProjectContextLoader } from "./session/project-context.ts";
import { buildAgentPrompt } from "./session/prompts.ts";
import { inheritRegisteredProviders } from "./session/provider-inheritance.ts";
import { deriveSubagentSessionDir } from "./session/session-dir.ts";
import { SettingsManager } from "./settings.ts";
import { AgentTool } from "./tools/agent-tool.ts";
import { GetResultTool } from "./tools/get-result-tool.ts";
import { SteerTool } from "./tools/steer-tool.ts";
import { AgentWidget } from "./ui/agent-widget.ts";
import {
  createNotificationRenderer,
  createUpdateRenderer,
  createWorkspaceNoticeRenderer,
} from "./ui/notification-renderer.ts";
import { SessionNavigatorHandler } from "./ui/session-navigator.ts";
import { SubagentModelHandler } from "./ui/subagent-model.ts";
import { SubagentsSettingsHandler } from "./ui/subagents-settings.ts";
import { loadSettings, updateSettings } from "../../../shared/settings.ts";

/**
 * The extension API captured for re-registration from `session_start`.
 * Assigned once at factory entry; the SDK's captured API goes stale after
 * `ctx.newSession()`, `fork()`, `switchSession()`, or `reload()`, which is why
 * the `session_start` re-scan below is wrapped in a try/catch.
 */
let capturedPi: ExtensionAPI;

/** Command names already registered by the delegate helper, across re-scans. */
const delegateCommands = new Set<string>();

export default function (pi: ExtensionAPI) {
  capturedPi = pi;

  // ---- Register custom notification renderer ----
  pi.registerMessageRenderer<NotificationDetails>("subagent-notification", createNotificationRenderer());
  pi.registerMessageRenderer<UpdateDetails>("subagent-update", createUpdateRenderer());
  pi.registerMessageRenderer<WorkspaceNoticeDetails>(
    "subagent-workspace-notice",
    createWorkspaceNoticeRenderer(),
  );

  const registry = new AgentTypeRegistry(
    () => loadCustomAgents(process.cwd()),
    () => settings.agentModels,
  );

  // ---- Runtime: all mutable extension state in one place ----
  const runtime = createSubagentRuntime();

  // ---- Notification system ----
  // Owns completion nudges and live-activity cleanup. The widget detects finished
  // agents itself (AgentWidget.update self-seeds), so NotificationManager has no
  // widget dependency — keeping the construction graph a cycle-free DAG.
  const notifications = new NotificationManager(
    (msg, opts) => pi.sendMessage(msg, opts),
  );

  // Gate nudge delivery on the parent's agent run. agent_settled fires exactly
  // once per run (from a finally block, so it also covers error and abort),
  // whereas agent_end fires once per run segment — retries, auto-compaction and
  // followUp continuations each emit one.
  pi.on("agent_start", () => notifications.onParentAgentStart());
  pi.on("agent_settled", () => notifications.onParentAgentSettled());

  // Settings: owns all three in-memory values and handles load/save/emit.
  // onMaxConcurrentChanged is wired to the limiter directly (closure captures by reference).
  const settings = new SettingsManager({
    emit: (event, payload) => pi.events.emit(event, payload),
    onMaxConcurrentChanged: () => limiter.recheck(),
  });
  settings.load();

  // Observer: receives agent lifecycle notifications and dispatches events/notifications.
  const eventsObserver = new SubagentEventsObserver({
    emit: (channel, data) => pi.events.emit(channel, data),
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
    notifications,
  });

  // Fan-out observer: lets the widget subscribe as a second lifecycle consumer
  // while the manager keeps its single-observer contract. The widget is added
  // after construction (it needs the manager); the manager consults the observer
  // only at spawn time, so registering late is safe.
  const observer = new CompositeSubagentObserver([eventsObserver]);

  const subagentSessionDeps: SubagentSessionDeps = {
    io: {
      detectEnv,
      getAgentDir,
      createResourceLoader: (opts) => new DefaultResourceLoader(opts),
      deriveSessionDir: deriveSubagentSessionDir,
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

  // ConcurrencyLimiter: schedules background run thunks FIFO against the limit.
  // It knows nothing about agents or the manager — dependency direction is strictly manager → limiter.
  const limiter = new ConcurrencyLimiter(() => settings.maxConcurrent);

  const manager = new SubagentManager({
    createSubagentSession: (params) => createSubagentSession(params, subagentSessionDeps),
    baseCwd: process.cwd(),
    observer,
    limiter,
    getRunConfig: () => settings,
    getRetentionPolicy: () => settings,
    registry,
  });

  // Typed service published via Symbol.for() for cross-extension access.
  // Consumers: const { getSubagentsService } = await import("@gotgenes/pi-subagents");
  const service = new SubagentsServiceAdapter(manager, resolveModel, runtime);
  publishSubagentsService(service);

  const lifecycle = new SessionLifecycleHandler(
    runtime,
    manager,
    () => notifications.dispose(),
    // A child shares the process-global service slot with its parent, so
    // unpublishing there would strip the parent's service. Only the parent
    // (never a child) unpublishes. `currentCtx` is still set here — the handler
    // unpublishes before it clears the session context.
    () => {
      const sessionId = runtime.currentCtx?.sessionManager.getSessionId();
      if (!isChildSession(sessionId)) unpublishSubagentsService();
    },
  );

  // Live widget: constructed after the manager (it polls listAgents()) and
  // registered as a lifecycle observer so it self-drives its update timer.
  const widget = new AgentWidget(manager, registry);
  observer.add(widget);

  // Give the widget its UI context and its turn ticks. Pi fans an event out to
  // every handler an extension registers for it, so these take their own
  // registrations rather than sharing a lambda with an unrelated concern.
  const widgetEvents = new WidgetEventsHandler(widget);

  // ---- pi-pack enable/disable toggle ----
  // Tools stay registered so the command can re-arm them; enabling/disabling
  // only changes the active tool set (what the model is offered) and the
  // widget's visibility. The choice persists in `~/.pi/couralabs/settings.json`.
  const SUBAGENT_TOOL_NAMES: readonly string[] = ["subagent", "get_subagent_result", "steer_subagent"];
  let subagentsEnabled = true;

  const setSubagentToolsActive = (active: boolean): void => {
    const current = pi.getActiveTools();
    if (active) {
      pi.setActiveTools([...new Set([...current, ...SUBAGENT_TOOL_NAMES])]);
    } else {
      pi.setActiveTools(current.filter((name) => !SUBAGENT_TOOL_NAMES.includes(name)));
    }
  };

  const applySubagentsEnabled = (isChild: boolean): void => {
    // A subagent must never be offered the subagent tools, whatever the operator
    // set in the parent: the child's own copy of this extension would otherwise
    // re-activate them in session_start, bypassing the SDK excludeTools denylist
    // (`setActiveTools()` re-checks the allowlist but not the denylist).
    if (isChild) {
      setSubagentToolsActive(false);
      widget.setEnabled(false);
      return;
    }
    setSubagentToolsActive(subagentsEnabled);
    widget.setEnabled(subagentsEnabled);
  };

  pi.on("session_start", (event, ctx) => lifecycle.handleSessionStart(event, ctx));
  pi.on("session_start", (event, ctx) => widgetEvents.handleSessionStart(event, ctx));
  // Registered after the widget handler so `ctx.ui` is already captured when the
  // persisted toggle is applied; a disabled session hides the widget again.
  // Child sessions force the toggle off, so a subagent can never spawn another.
  pi.on("session_start", (_event, ctx) => {
    const isChild = isChildSession(ctx.sessionManager.getSessionId());
    subagentsEnabled = isChild ? false : loadSettings().subagents.enabled;
    applySubagentsEnabled(isChild);
    // Re-scan so agents added while pi is running appear. The captured `pi` goes
    // stale after `newSession`/`fork`/`switchSession`/`reload`, so a failed
    // registration is ignored rather than crashing the session.
    try {
      registerDelegateCommands({
        pi: capturedPi,
        manager,
        runtime,
        registry,
        settings,
        subagentsEnabled: () => subagentsEnabled,
        registered: delegateCommands,
        notify: (message, level) => ctx.ui.notify(message, level),
      });
    } catch {
      // The captured extension API is stale; the next session_start re-registers.
    }
  });
  pi.on("session_before_switch", () => lifecycle.handleSessionBeforeSwitch());
  pi.on("session_shutdown", () => lifecycle.handleSessionShutdown());
  // Registered after the lifecycle handler on purpose. Pi awaits an extension's
  // handlers for an event in registration order, so the widget is torn down once
  // `abortAll()` and the awaited `manager.dispose()` have finished — no terminal
  // transition is left to drive an `update()` at a half-disposed widget.
  pi.on("session_shutdown", () => widgetEvents.handleSessionShutdown());

  // Capture the prompt parts Pi assembled for the parent's turn. This is the
  // only event carrying them — `getSystemPromptOptions()` is attached to a
  // command context, not to the session context the runtime holds — and a spawn
  // renders the parent's portable identity from the latest capture.
  pi.on("before_agent_start", (event) => {
    runtime.setSystemPromptOptions(event.systemPromptOptions);
  });

  // Abort all subagents when the parent agent loop is interrupted (ESC), unless
  // the user has turned that policy off. The predicate is read at abort time.
  const interrupt = new InterruptHandler(manager, () => settings.abortAllOnInterrupt);
  pi.on("turn_start", (_event, ctx) => interrupt.handleTurnStart(ctx));
  pi.on("turn_start", () => widgetEvents.handleTurnStart());

  // ---- Agent tool ----

  pi.registerTool(new AgentTool(manager, runtime, settings, registry).toToolDefinition());

  // ---- get_subagent_result tool ----

  pi.registerTool(new GetResultTool(manager, registry).toToolDefinition());

  // ---- steer_subagent tool ----

  pi.registerTool(new SteerTool(manager, pi.events).toToolDefinition());

  // ---- /subagents command ----

  pi.registerCommand("subagents", {
    description: "Toggle pi-pack subagents and their tools (usage: /subagents [on|off])",
    handler: async (args, ctx) => {
      if (isChildSession(ctx.sessionManager.getSessionId())) {
        ctx.ui.notify("Subagents cannot be enabled inside a subagent session", "warning");
        return;
      }
      const arg = args.trim().toLowerCase();
      if (arg === "on") subagentsEnabled = true;
      else if (arg === "off") subagentsEnabled = false;
      else subagentsEnabled = !subagentsEnabled;

      updateSettings({ subagents: { enabled: subagentsEnabled } });
      applySubagentsEnabled(false);
      ctx.ui.notify(
        subagentsEnabled
          ? "pi-pack subagents enabled"
          : "pi-pack subagents disabled — tools hidden and widget cleared",
        "info",
      );
    },
  });

  // ---- /subagents:settings command ----

  const subagentsSettings = new SubagentsSettingsHandler(settings);

  pi.registerCommand("subagents:settings", {
    description: "Configure pi-pack subagents (concurrency, turn limits, retention, interrupt policy)",
    handler: async (_args, ctx) => {
      if (!subagentsEnabled) {
        ctx.ui.notify("pi-pack subagents are disabled — run /subagents on", "warning");
        return;
      }
      await subagentsSettings.handle({ ui: ctx.ui });
    },
  });

  // ---- /subagents:sessions command ----

  const sessionNavigator = new SessionNavigatorHandler();

  pi.registerCommand("subagents:sessions", {
    description: "View a subagent's session transcript (read-only)",
    handler: async (_args, ctx) => {
      if (!subagentsEnabled) {
        ctx.ui.notify("pi-pack subagents are disabled — run /subagents on", "warning");
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

  // ---- /subagent-model command ----

  const subagentModelHandler = new SubagentModelHandler();

  pi.registerCommand("subagent-model", {
    description: "Set the default model for a subagent (built-in or .agents/agents/*.md)",
    handler: async (_args, ctx) => {
      if (!subagentsEnabled) {
        ctx.ui.notify("pi-pack subagents are disabled — run /subagents on", "warning");
        return;
      }
      await subagentModelHandler.handle({
        ui: ctx.ui,
        agents: registry.list(),
        cwd: ctx.cwd,
        models:
          ctx.scopedModels.length > 0
            ? ctx.scopedModels.map((scoped) => scoped.model)
            : ctx.modelRegistry.getAvailable(),
        setAgentModel: (agentName, modelId) => {
          settings.applyAgentModel(agentName, modelId);
        },
      });
    },
  });

  // ---- /delegate:<agent-name> commands ----
  // One command per discovered agent, registered from the current registry. The
  // session_start handler above re-scans so agents added later appear.
  registerDelegateCommands({
    pi: capturedPi,
    manager,
    runtime,
    registry,
    settings,
    subagentsEnabled: () => subagentsEnabled,
    registered: delegateCommands,
    // No UI context exists at extension load; the session_start re-scan reports
    // skipped names to the user instead.
    notify: () => {},
  });
}
