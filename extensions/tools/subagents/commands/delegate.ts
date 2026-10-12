/**
 * delegate.ts — `/delegate:<agent-name> [prompt]` commands.
 *
 * One command per discovered agent, registered from the live registry. Running
 * `/delegate:Explore <prompt>` spawns that agent in the foreground and delivers
 * its result into the conversation the way a tool-spawned completion is
 * delivered, so the registered `subagent-notification` renderer draws it
 * identically.
 *
 * The command name preserves the agent's case: pi's dispatch is exact-match and
 * case-sensitive, so `Explore` registers as `delegate:Explore`, not
 * `delegate:explore`.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentTypeRegistry } from "../config/agent-types.ts";
import {
	buildNotificationDetails,
	formatTaskNotification,
} from "../observation/notification.ts";
import {
	renderQuestionAffordance,
	renderRunUpdates,
	renderWorkspaceNotice,
} from "../observation/outcome-delivery.ts";
import type { SubagentRuntime } from "../runtime.ts";
import type { SettingsManager } from "../settings.ts";
import { type ForegroundManagerDeps, runForeground } from "../tools/foreground-runner.ts";
import { resolveSpawnConfig } from "../tools/spawn-config.ts";
import type { ParentSessionInfo, Subagent } from "../types.ts";

/** The command-name prefix every delegate command shares. */
export const DELEGATE_PREFIX = "delegate:";

/** The renderer custom type a tool-spawned completion nudge uses. */
const NOTIFICATION_TYPE = "subagent-notification";

/** Characters of an agent's own description kept in the command description. */
const DESCRIPTION_BUDGET = 120;

/** One delegate command to register. */
export interface DelegateCommand {
	/** The command name, e.g. `delegate:Explore`. */
	command: string;
	/** The canonical agent name, case preserved. */
	name: string;
	/** The command description shown in pi's command list. */
	description: string;
}

/** The commands a registry yields, plus the names that cannot be addressed. */
export interface DelegateCommandPlan {
	commands: DelegateCommand[];
	/** Agent names skipped because their name cannot form a command. */
	skipped: string[];
}

/** The narrow registry view this module needs; `AgentTypeRegistry` satisfies it. */
export interface DelegateAgentSource {
	list(): readonly { name: string; description: string }[];
}

/**
 * Plan the delegate commands for a registry without registering anything.
 *
 * Pure, so the naming rules (case preservation, whitespace rejection) are
 * testable without a pi host. A name containing whitespace cannot be addressed:
 * pi terminates a command name at the first space, so `/delegate:my agent`
 * would invoke a command named `/delegate:my` with `agent …` as its args.
 */
export function planDelegateCommands(registry: DelegateAgentSource): DelegateCommandPlan {
	const commands: DelegateCommand[] = [];
	const skipped: string[] = [];
	for (const agent of registry.list()) {
		if (/\s/.test(agent.name)) {
			skipped.push(agent.name);
			continue;
		}
		commands.push({
			command: `${DELEGATE_PREFIX}${agent.name}`,
			name: agent.name,
			description: describeDelegate(agent.name, agent.description),
		});
	}
	return { commands, skipped };
}

/** The command description: usage line plus the agent's own description, clipped. */
function describeDelegate(name: string, description: string): string {
	const usage = `Spawn the ${name} subagent (usage: /${DELEGATE_PREFIX}${name} <prompt>)`;
	const trimmed = description.trim();
	if (!trimmed) return usage;
	const clipped =
		trimmed.length > DESCRIPTION_BUDGET ? `${trimmed.slice(0, DESCRIPTION_BUDGET - 1)}…` : trimmed;
	return `${usage} — ${clipped}`;
}

/** Everything the registration helper needs, all in the factory's closure. */
export interface DelegateDeps {
	pi: ExtensionAPI;
	manager: ForegroundManagerDeps;
	runtime: SubagentRuntime;
	registry: AgentTypeRegistry;
	settings: SettingsManager;
	/** Whether pi-pack subagents are enabled; read when a command runs. */
	subagentsEnabled: () => boolean;
	/** Command names already registered; mutated as commands are added. */
	registered: Set<string>;
	/**
	 * Report the agent names that cannot be addressed. The factory has no UI, so
	 * it passes a no-op and the `session_start` re-scan supplies `ctx.ui.notify`.
	 */
	notify: (message: string, level: "info" | "warning" | "error") => void;
}

/**
 * Register one `/delegate:<name>` command per discovered agent.
 *
 * Safe to call repeatedly: names already in `registered` are skipped, so a
 * `session_start` re-scan after the extension factory only adds agents that
 * appeared since. The registry is reloaded first so `.agents/agents/*.md` files
 * added while pi is running are picked up.
 */
export function registerDelegateCommands(deps: DelegateDeps): void {
	deps.registry.reload();
	const { commands, skipped } = planDelegateCommands(deps.registry);
	if (skipped.length > 0) {
		deps.notify(
			`Skipped ${skipped.length} agent name(s) that cannot be addressed as commands (whitespace in the name): ${skipped.join(", ")}`,
			"warning",
		);
	}
	for (const entry of commands) {
		if (deps.registered.has(entry.command)) continue;
		deps.registered.add(entry.command);
		deps.pi.registerCommand(entry.command, {
			description: entry.description,
			handler: (args, ctx) => runDelegate(deps, entry.name, args, ctx),
		});
	}
}

/**
 * Run one delegate spawn: resolve config, spawn in the foreground, and deliver
 * the outcome into the conversation.
 */
async function runDelegate(
	deps: DelegateDeps,
	name: string,
	args: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	if (!deps.subagentsEnabled()) {
		ctx.ui.notify("pi-pack subagents are disabled — run /subagents on", "warning");
		return;
	}
	const prompt = args.trim();
	if (!prompt) {
		ctx.ui.notify(`Usage: /${DELEGATE_PREFIX}${name} <prompt>`, "warning");
		return;
	}
	ctx.ui.notify(`Spawning the ${name} subagent…`, "info");

	const config = resolveSpawnConfig(
		{ subagent_type: name, prompt, description: `Delegate to ${name}` },
		deps.registry,
		deps.runtime.getModelInfo(),
		deps.settings,
	);
	if ("error" in config) {
		ctx.ui.notify(config.error, "error");
		return;
	}

	// Capture the record the foreground runner spawns, so the completion
	// notification can be built from it. `runForeground` is the tool's own path;
	// wrapping the manager is the seam that lets a command reuse it and still
	// hold the record.
	let record: Subagent | undefined;
	const capturing: ForegroundManagerDeps = {
		spawnAndWait: (snapshot, type, spawnPrompt, opts) =>
			deps.manager.spawnAndWait(snapshot, type, spawnPrompt, opts).then((settled) => {
				record = settled;
				return settled;
			}),
	};

	try {
		const snapshot = deps.runtime.buildSnapshot(config.execution.inheritContext);
		const { parentSessionFile, parentSessionId } = deps.runtime.getSessionInfo();
		const parentSession: ParentSessionInfo = { parentSessionFile, parentSessionId };
		const result = await runForeground(
			capturing,
			{ config, snapshot, parentSession },
			ctx.signal,
			undefined,
		);
		if (!record) {
			// The runner swallowed a spawn failure into the tool result; surface it.
			const text =
				result.content[0]?.type === "text" ? result.content[0].text : "The subagent failed to start.";
			ctx.ui.notify(text, "error");
			return;
		}
		deliverDelegateResult(deps.pi, record);
	} catch (err) {
		// A thrown manager error (a disabled agent, no resolvable model) is not
		// caught anywhere above a command handler, so report it here.
		ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
	}
}

/**
 * Deliver a delegate spawn's outcome into the conversation.
 *
 * Composes the completion nudge's shape: the `subagent-notification` custom
 * type, `formatTaskNotification` content, and `buildNotificationDetails`
 * details, so the registered renderer draws a delegate result exactly like a
 * tool-spawned completion. `NotificationManager.emitIndividualNudge` owns this
 * shape but is private, and the manager is not in this module's dependencies,
 * so the shape is composed here rather than reused.
 */
function deliverDelegateResult(pi: ExtensionAPI, record: Subagent): void {
	const transcriptLine = record.outputFile
		? `\nFull transcript available at: ${record.outputFile}`
		: "";
	const content =
		formatTaskNotification(record, 500) +
		renderRunUpdates(record.runUpdates) +
		renderWorkspaceNotice(record.workspaceNotice) +
		`${transcriptLine}\nCall get_subagent_result("${record.id}") to collect the full result.` +
		renderQuestionAffordance(record.id, record.pendingQuestion, record.resumeRefusal);
	pi.sendMessage(
		{
			customType: NOTIFICATION_TYPE,
			content,
			display: true,
			details: buildNotificationDetails(record, 500),
		},
		{ deliverAs: "followUp", triggerTurn: true },
	);
}
