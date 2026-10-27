import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	compactSession,
	discardCompactionRebase,
	listSdkAgents,
	listSdkSlashCommands,
	listTasks,
	observeSessionMessages,
	resetSession,
	setSessionModel,
	stopTask,
} from "./bridge.ts";
import type { SdkSlashCommand } from "./bridge.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_PROVIDER_ID } from "../../../shared/modes.ts";
import { BACKGROUND_REPORT_ENTRY_TYPE, observeBackgroundReports } from "./background-tasks.ts";

type NotifyLevel = "info" | "warning" | "error";

interface RedirectRequest {
	readonly pi: ExtensionAPI;
	readonly args: string;
	readonly context: ExtensionCommandContext;
	readonly original: (args: string, context: ExtensionCommandContext) => Promise<void>;
}

type CommandRedirect = (request: RedirectRequest) => Promise<void>;

const PI_BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set([
	"settings",
	"model",
	"tree",
	"thinking",
	"scoped-models",
	"export",
	"import",
	"share",
	"bug",
	"copy",
	"name",
	"session",
	"changelog",
	"hotkeys",
	"fork",
	"clone",
	"trust",
	"login",
	"logout",
	"new",
	"compact",
	"resume",
	"reload",
	"quit",
	"debug",
]);

const SDK_COMMANDS_HANDLED_BY_PI: ReadonlySet<string> = new Set(["clear", "reset", "exit", "help", "config", "status"]);

const COMPACTION_SUMMARY = "Context compacted by the Claude Agent SDK (/compact). The SDK session holds the condensed history.";

const SPAWN_CHANGES_NOTICE = "Agent definition changes apply to the next Claude session (/new).";

function isClaudeActive(context: ExtensionContext): boolean {
	return context.model?.provider === CLAUDE_PROVIDER_ID;
}

function sessionKeyOf(context: ExtensionContext): string {
	return context.sessionManager.getSessionId();
}

function report(context: ExtensionContext, text: string, level: NotifyLevel = "info"): void {
	if (context.hasUI) {
		context.ui.notify(text, level);
		return;
	}
	console.error(text);
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sendThroughSdk(pi: ExtensionAPI, context: ExtensionCommandContext, text: string): void {
	pi.sendUserMessage(text, context.isIdle() ? undefined : { deliverAs: "followUp" });
}

function formatTaskRows(sessionKey: string): string {
	const tasks = listTasks(sessionKey);
	if (tasks.length === 0) return "No background tasks.";
	return tasks
		.map((task) => `${task.taskId}  ${task.subagentType ?? task.taskType}  ${task.description}`)
		.join("\n");
}

const jobRedirect: CommandRedirect = async ({ pi, args, context }) => {
	const command = args.trim();
	if (!command) {
		report(context, formatTaskRows(sessionKeyOf(context)));
		return;
	}
	sendThroughSdk(pi, context, `Run this as a background task (Bash with run_in_background) and report its task id: ${command}`);
};

const jobListRedirect: CommandRedirect = async ({ context }) => {
	report(context, formatTaskRows(sessionKeyOf(context)));
};

const jobKillRedirect: CommandRedirect = async ({ args, context }) => {
	const taskId = args.trim();
	if (!taskId) {
		report(context, "Usage: /job-kill <taskId>", "error");
		return;
	}
	try {
		await stopTask(sessionKeyOf(context), taskId);
		report(context, `Stop requested for ${taskId}.`);
	} catch (error) {
		report(context, describeError(error), "error");
	}
};

const jobReadRedirect: CommandRedirect = async ({ pi, args, context }) => {
	const [taskId, lines] = args.trim().split(/\s+/);
	if (!taskId) {
		report(context, "Usage: /job-read <taskId> [lines]", "error");
		return;
	}
	const limit = lines ? ` (last ${lines} lines)` : "";
	sendThroughSdk(pi, context, `Show the latest output of background task ${taskId}${limit}.`);
};

const spawnSessionsRedirect: CommandRedirect = async ({ context }) => {
	const sessionKey = sessionKeyOf(context);
	try {
		const agents = await listSdkAgents(sessionKey);
		const agentRows = agents.map((agent) => `${agent.name}  ${agent.model ?? "inherit"}  ${agent.description}`);
		const running = listTasks(sessionKey)
			.filter((task) => task.subagentType !== undefined)
			.map((task) => `${task.taskId}  ${task.subagentType}  ${task.description}`);
		const sections = [
			`Agents:\n${agentRows.length > 0 ? agentRows.join("\n") : "(none)"}`,
			`Running:\n${running.length > 0 ? running.join("\n") : "(none)"}`,
		];
		report(context, sections.join("\n\n"));
	} catch (error) {
		report(context, describeError(error), "error");
	}
};

const spawnModelRedirect: CommandRedirect = async ({ args, context, original }) => {
	await original(args, context);
	report(context, SPAWN_CHANGES_NOTICE);
};

const spawnSettingsRedirect: CommandRedirect = async ({ context }) => {
	report(
		context,
		"Pi spawn limits do not apply to Claude subagents. Edit max_turns and model in .agents/agents/*.md (see /spawn:model). " +
			SPAWN_CHANGES_NOTICE,
		"warning",
	);
};

const COMMAND_REDIRECTS: ReadonlyMap<string, CommandRedirect> = new Map([
	["job", jobRedirect],
	["job-list", jobListRedirect],
	["job-kill", jobKillRedirect],
	["job-read", jobReadRedirect],
	["spawn:sessions", spawnSessionsRedirect],
	["spawn:model", spawnModelRedirect],
	["spawn:settings", spawnSettingsRedirect],
]);

export function withClaudeCommandRedirects(pi: ExtensionAPI): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property) {
			if (property !== "registerCommand") {
				const value = Reflect.get(target, property, target);
				return typeof value === "function" ? value.bind(target) : value;
			}
			const registerCommand: ExtensionAPI["registerCommand"] = (name, options) => {
				const redirect = COMMAND_REDIRECTS.get(name);
				if (!redirect) {
					target.registerCommand(name, options);
					return;
				}
				target.registerCommand(name, {
					...options,
					handler: async (args, context) => {
						if (!isClaudeActive(context)) {
							await options.handler(args, context);
							return;
						}
						await redirect({ pi: target, args, context, original: options.handler });
					},
				});
			};
			return registerCommand;
		},
	});
}

function formatSlashInvocation(name: string, args: string): string {
	const trimmedArgs = args.trim();
	return trimmedArgs ? `/${name} ${trimmedArgs}` : `/${name}`;
}

export function registerClaudeCommands(pi: ExtensionAPI): void {
	const passThroughNames = new Set<string>();

	const registerPassThrough = (commands: readonly SdkSlashCommand[]): void => {
		const reserved = new Set(pi.getCommands().map((command) => command.name));
		for (const command of commands) {
			const { name } = command;
			if (passThroughNames.has(name) || reserved.has(name)) continue;
			if (PI_BUILTIN_COMMAND_NAMES.has(name) || SDK_COMMANDS_HANDLED_BY_PI.has(name) || COMMAND_REDIRECTS.has(name)) continue;
			passThroughNames.add(name);
			pi.registerCommand(name, {
				description: `[Claude] ${command.description}${command.argumentHint ? ` ${command.argumentHint}` : ""}`,
				handler: async (args, context) => {
					if (!isClaudeActive(context)) {
						report(context, `/${name} is a Claude Agent SDK command and needs a claude/* model.`, "warning");
						return;
					}
					sendThroughSdk(pi, context, formatSlashInvocation(name, args));
				},
			});
		}
	};

	const onSdkMessage = (message: SDKMessage): void => {
		if (message.type === "system" && message.subtype === "commands_changed") registerPassThrough(message.commands);
	};

	const attachToSession = async (context: ExtensionContext): Promise<void> => {
		const sessionKey = sessionKeyOf(context);
		if (!observeSessionMessages(sessionKey, onSdkMessage)) return;
		observeBackgroundReports((reportSessionKey, data) => {
			if (reportSessionKey !== sessionKey) return;
			pi.appendEntry(BACKGROUND_REPORT_ENTRY_TYPE, data);
		});
		registerPassThrough(await listSdkSlashCommands(sessionKey));
	};

	pi.on("message_start", (event, context) => {
		if (event.message.role !== "assistant" || !isClaudeActive(context)) return;
		attachToSession(context).catch((error: unknown) => {
			report(context, `Claude slash commands unavailable: ${describeError(error)}`, "warning");
		});
	});

	pi.on("message_end", (event, context) => {
		if (event.message.role === "assistant" && event.message.provider !== CLAUDE_PROVIDER_ID) {
			discardCompactionRebase(sessionKeyOf(context));
		}
	});

	pi.on("session_before_compact", async (event, context) => {
		if (!isClaudeActive(context)) return undefined;
		try {
			const outcome = await compactSession(sessionKeyOf(context), event.customInstructions);
			if (!outcome) {
				report(context, "Nothing to compact: no Claude session is active yet.", "warning");
				return { cancel: true };
			}
			return {
				compaction: {
					summary: outcome.summary ?? COMPACTION_SUMMARY,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: outcome.preTokens,
					estimatedTokensAfter: outcome.postTokens,
					details: { source: "claude-agent-sdk", trigger: event.reason },
				},
			};
		} catch (error) {
			report(context, `Claude /compact failed: ${describeError(error)}`, "error");
			return { cancel: true };
		}
	});

	pi.on("session_shutdown", (event, context) => {
		if (event.reason !== "new") return;
		resetSession(sessionKeyOf(context));
	});

	pi.on("model_select", async (event, context) => {
		if (event.model.provider !== CLAUDE_PROVIDER_ID) return;
		try {
			await setSessionModel(sessionKeyOf(context), event.model.id);
		} catch (error) {
			report(context, `Claude model switch failed: ${describeError(error)}`, "error");
		}
	});
}
