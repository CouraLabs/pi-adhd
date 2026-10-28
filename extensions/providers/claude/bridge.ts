import { randomUUID } from "node:crypto";
import { getSessionInfo, query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Api, AssistantMessageEventStream, Message, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { fromPiAgentDefinitions } from "./agents.ts";
import { resolveConfiguredDefaultModel } from "../../tools/spawn/config/default-model.ts";
import { buildSubmodeAppend, foregroundAgentHook, submodePolicyHook } from "./policy.ts";
import { PI_MCP_SERVER_NAME, PiToolServer, isPiOwnedToolName } from "./pi-mcp.ts";
import type { PiToolDescriptions } from "./pi-mcp.ts";
import { attachInterruptedAgents, clearLimitHit, hasLimitHit, recordLimitHit } from "./limit-handoff/pending-limit.ts";
import { agentProgressRouter } from "./render-agent.ts";
import { askAnswerBroker, createAskCanUseTool, createAskPreToolUseHook } from "./render-ask.ts";
import { WakeTurnCollector } from "./background-tasks.ts";
import { SDK_TOOL_NAMES } from "./sdk-tools.ts";
import { getSessionHost, takeRestoredRecord } from "./session-host.ts";
import { conversationOf, markPrefix, planSync, renderCatchUp, renderSeed } from "./session-sync.ts";
import type { SyncMark, SyncRecord } from "./session-sync.ts";
import { toolResultBroker } from "./tool-result-broker.ts";
import type { SdkToolResult } from "./tool-result-broker.ts";
import { createAssistantShell, buildUserMessage, TurnTranslator } from "./translate.ts";

const SDK_SETTINGS: NonNullable<Options["settings"]> = {
	agentPushNotifEnabled: true,
	showMessageTimestamps: true,
	idleCompaction: false,
	autoCompactEnabled: true,
	showThinkingSummaries: true,
	autoMemoryEnabled: false,
	emojiCompletionEnabled: false,
	spinnerTipsEnabled: false,
	disableAgentView: true,
	allowAllClaudeAiMcps: false,
	includeGitInstructions: false,
	syncClaudeAiPlugins: false,
	syncClaudeAiSkills: false,
	enableAllProjectMcpServers: true,
	promptCacheTtl: "1h",
	subagentPromptCacheTtl: "1h",
	viewMode: "verbose",
	attribution: { commit: "", pr: "" },
};

class AsyncQueue<T> implements AsyncIterable<T> {
	private readonly pending: T[] = [];
	private waiting: { resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void } | undefined;
	private closed = false;
	private failure: Error | undefined;

	push(item: T): void {
		if (this.closed) throw new Error("claude provider: queue is closed");
		if (this.waiting) {
			const { resolve } = this.waiting;
			this.waiting = undefined;
			resolve({ value: item, done: false });
			return;
		}
		this.pending.push(item);
	}

	close(failure?: Error): void {
		this.closed = true;
		this.failure = failure;
		const waiter = this.waiting;
		this.waiting = undefined;
		if (!waiter) return;
		if (failure) waiter.reject(failure);
		else waiter.resolve({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: () => {
				if (this.pending.length > 0) return Promise.resolve({ value: this.pending.shift() as T, done: false });
				if (this.failure) return Promise.reject(this.failure);
				if (this.closed) return Promise.resolve({ value: undefined, done: true });
				return new Promise((resolve, reject) => {
					this.waiting = { resolve, reject };
				});
			},
		};
	}
}

interface ClaudeSessionState {
	readonly sdkQuery: Query;
	readonly input: AsyncQueue<SDKUserMessage>;
	readonly messages: AsyncQueue<SDKMessage>;
	readonly lifetime: AbortController;
	readonly piToolServer: PiToolServer;
	readonly listeners: Set<SessionMessageListener>;
	activeTurn: Promise<void>;
	awaitingToolResults: boolean;
	pendingUuid: string | undefined;
	wake: WakeTurnCollector | undefined;
	appliedSubmodeAppend: string | undefined;
	sdkSessionId: string | undefined;
	synced: SyncMark | undefined;
	rebaseNextTurn: boolean;
	compactionSummary: string | undefined;
}

interface ResumeSource {
	readonly sdkSessionId: string;
	readonly fork: boolean;
}

const sessions = new Map<string, ClaudeSessionState>();

let describePiTools: () => PiToolDescriptions = () => ({});

export function configurePiToolDescriptions(source: () => PiToolDescriptions): void {
	describePiTools = source;
}

function submodeChangeNotice(current: string | undefined): string {
	return current === undefined
		? "<system-reminder>The previous submode has ended. Its instructions and tool restrictions no longer apply.</system-reminder>"
		: `<system-reminder>The active submode changed. These instructions replace any earlier submode instructions:\n\n${current}</system-reminder>`;
}

export function buildQueryOptions(
	model: Model<Api>,
	lifetime: AbortController,
	reasoningRequested: boolean,
	piToolServer: PiToolServer,
	submodeAppend: string | undefined,
	sessionKey: string,
	cwd: string,
	interactive: boolean,
	newSessionId: string | undefined,
	resumeSource: ResumeSource | undefined,
): Options {
	const foregroundHooks = interactive ? [] : [foregroundAgentHook];
	return {
		model: model.id,
		cwd,
		...(resumeSource ? { resume: resumeSource.sdkSessionId, forkSession: resumeSource.fork } : {}),
		...(newSessionId ? { sessionId: newSessionId } : {}),
		tools: [...SDK_TOOL_NAMES],
		disallowedTools: ["Agent(Explore)", "Agent(Plan)", "Agent(statusline-setup)"],
		systemPrompt: { type: "preset", preset: "claude_code", ...(submodeAppend ? { append: submodeAppend } : {}) },
		mcpServers: { [PI_MCP_SERVER_NAME]: piToolServer.server },
		hooks: {
			PreToolUse: [{ hooks: [submodePolicyHook, ...foregroundHooks, piToolServer.captureToolUseIdHook, createAskPreToolUseHook(sessionKey)] }],
		},
		canUseTool: createAskCanUseTool(sessionKey),
		agents: fromPiAgentDefinitions(cwd, resolveConfiguredDefaultModel(cwd)),
		enableFileCheckpointing: true,
		extraArgs: { "replay-user-messages": null },

		permissionMode: "auto",
		settings: SDK_SETTINGS,
		settingSources: ["user", "project", "local"],
		skills: "all",
		agentProgressSummaries: true,
		includePartialMessages: true,
		includeHookEvents: true,
		abortController: lifetime,
		env: { ...process.env, ENABLE_TOOL_SEARCH: "false", CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: "1" },
		...(reasoningRequested ? { thinking: { type: "adaptive", display: "summarized" } } : {}),
	};
}

function normalizeToolResultContent(content: unknown): SdkToolResult["content"] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	if (!Array.isArray(content)) return [{ type: "text", text: "" }];
	const blocks: SdkToolResult["content"] = [];
	for (const block of content) {
		if (block?.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
		} else if (block?.type === "image" && block.source?.type === "base64") {
			blocks.push({ type: "image", data: block.source.data, mimeType: block.source.media_type });
		}
	}
	return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function deliverToolResults(message: Extract<SDKMessage, { type: "user" }>): void {
	if (message.parent_tool_use_id !== null) return;
	const content = message.message.content;
	if (!Array.isArray(content)) return;
	for (const block of content) {
		if (block.type !== "tool_result") continue;
		toolResultBroker.deliver(block.tool_use_id, {
			content: normalizeToolResultContent(block.content),
			isError: block.is_error === true,
		});
	}
}

function releaseSessionResources(sessionKey: string, reason: string): void {
	toolResultBroker.disposeSession(sessionKey, reason);
	askAnswerBroker.disposeSession(sessionKey, reason);
	agentProgressRouter.disposeSession(sessionKey);
}

async function pumpSdkMessages(sessionKey: string, state: ClaudeSessionState): Promise<void> {
	try {
		for await (const sdkMessage of state.sdkQuery) {
			observeSdkMessage(sessionKey, state, sdkMessage);
			agentProgressRouter.route(sessionKey, sdkMessage);
			if (sdkMessage.type === "user") deliverToolResults(sdkMessage);
			else routeTurnMessage(sessionKey, state, sdkMessage);
		}
		state.messages.close();
		releaseSessionResources(sessionKey, "Claude session ended");
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		state.messages.close(failure);
		releaseSessionResources(sessionKey, failure.message);
	}
}

function stampOf(message: SDKMessage): string[] | undefined {
	if (message.type !== "assistant" && message.type !== "result" && message.type !== "stream_event") return undefined;
	if (message.user_message_uuids !== undefined) return [...message.user_message_uuids];
	if (message.user_message_uuid !== undefined) return [message.user_message_uuid];
	return undefined;
}

function feedWakeTurn(sessionKey: string, state: ClaudeSessionState, message: SDKMessage): void {
	let wake = state.wake;
	if (!wake) {
		wake = new WakeTurnCollector(sessionKey);
		state.wake = wake;
	}
	wake.feed(message);
}

function routeTurnMessage(sessionKey: string, state: ClaudeSessionState, message: SDKMessage): void {
	const stamp = stampOf(message);
	if (stamp !== undefined) {
		if (state.pendingUuid !== undefined && stamp.includes(state.pendingUuid)) {
			state.wake = undefined;
			if (message.type === "result") state.pendingUuid = undefined;
			state.messages.push(message);
			return;
		}
		feedWakeTurn(sessionKey, state, message);
		return;
	}
	if (state.wake?.collecting) {
		state.wake.feed(message);
		return;
	}
	if (state.pendingUuid === undefined) {
		feedWakeTurn(sessionKey, state, message);
		return;
	}
	state.messages.push(message);
}

function openSession(
	sessionKey: string,
	model: Model<Api>,
	reasoningRequested: boolean,
	resumeSource: ResumeSource | undefined,
): ClaudeSessionState {
	const input = new AsyncQueue<SDKUserMessage>();
	const lifetime = new AbortController();
	const submodeAppend = buildSubmodeAppend();
	const host = getSessionHost(sessionKey);
	const newSessionId = resumeSource ? undefined : randomUUID();
	const piToolServer = new PiToolServer(describePiTools());
	const sdkQuery = query({
		prompt: input,
		options: buildQueryOptions(
			model,
			lifetime,
			reasoningRequested,
			piToolServer,
			submodeAppend,
			sessionKey,
			host?.cwd ?? process.cwd(),
			host?.interactive ?? false,
			newSessionId,
			resumeSource,
		),
	});
	const state: ClaudeSessionState = {
		sdkQuery,
		input,
		messages: new AsyncQueue<SDKMessage>(),
		lifetime,
		piToolServer,
		listeners: new Set(),
		activeTurn: Promise.resolve(),
		awaitingToolResults: false,
		pendingUuid: undefined,
		wake: undefined,
		appliedSubmodeAppend: submodeAppend,
		sdkSessionId: resumeSource && !resumeSource.fork ? resumeSource.sdkSessionId : newSessionId,
		synced: undefined,
		rebaseNextTurn: false,
		compactionSummary: undefined,
	};
	void pumpSdkMessages(sessionKey, state);
	return state;
}

export function disposeClaudeSession(sessionKey: string): void {
	const state = sessions.get(sessionKey);
	if (!state) return;
	sessions.delete(sessionKey);
	backgroundTasksBySession.delete(sessionKey);
	state.input.close();
	state.lifetime.abort();
	state.sdkQuery.close();
	releaseSessionResources(sessionKey, "Claude session disposed");
}

async function nextSdkMessage(state: ClaudeSessionState): Promise<SDKMessage> {
	const next = await state.messages[Symbol.asyncIterator]().next();
	if (next.done) throw new Error("Claude session ended before returning a result");
	return next.value;
}

async function consumeUntilBoundary(state: ClaudeSessionState, translator: TurnTranslator): Promise<void> {
	for (;;) {
		const sdkMessage = await nextSdkMessage(state);
		if (!translator.finished) translator.handle(sdkMessage);
		if (sdkMessage.type === "result") {
			state.awaitingToolResults = false;
			state.piToolServer.clearClaims();
			return;
		}
		if (translator.pausedForToolResults) {
			state.awaitingToolResults = true;
			return;
		}
	}
}

function deliverPiToolResults(messages: Message[]): void {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "toolResult") break;
		if (!isPiOwnedToolName(message.toolName)) continue;
		toolResultBroker.deliver(message.toolCallId, { content: message.content, isError: message.isError });
	}
}

async function abandonPendingRun(sessionKey: string, state: ClaudeSessionState): Promise<void> {
	state.awaitingToolResults = false;
	state.piToolServer.clearClaims();
	toolResultBroker.disposeSession(sessionKey, "Superseded by a new user message");
	await state.sdkQuery.interrupt();
	for (;;) {
		const sdkMessage = await nextSdkMessage(state);
		if (sdkMessage.type === "result") return;
	}
}

interface PreparedSession {
	readonly session: ClaudeSessionState;
	readonly catchUp: string | undefined;
}

async function resumableSource(sessionKey: string, record: SyncRecord | undefined): Promise<ResumeSource | undefined> {
	if (!record) return undefined;
	const cwd = getSessionHost(sessionKey)?.cwd ?? process.cwd();
	try {
		const info = await getSessionInfo(record.sdkSessionId, { dir: cwd });
		return info ? { sdkSessionId: record.sdkSessionId, fork: record.piSessionId !== sessionKey } : undefined;
	} catch {
		return undefined;
	}
}

async function prepareSession(
	sessionKey: string,
	model: Model<Api>,
	reasoningRequested: boolean,
	conversation: Message[],
): Promise<PreparedSession> {
	const existing = sessions.get(sessionKey);
	const restored = takeRestoredRecord(sessionKey);
	const rebased = existing?.rebaseNextTurn === true;
	if (existing) existing.rebaseNextTurn = false;

	const userIndex = conversation.map((message) => message.role).lastIndexOf("user");
	const mark = rebased ? markPrefix(conversation, Math.max(userIndex, 0)) : (existing?.synced ?? restored);
	const plan = planSync(conversation, mark);

	if (existing && plan.kind === "in-sync") return { session: existing, catchUp: renderCatchUp(plan.missed) };
	if (existing) disposeClaudeSession(sessionKey);

	if (plan.kind === "in-sync") {
		const source = await resumableSource(sessionKey, restored);
		if (source) {
			const resumed = openSession(sessionKey, model, reasoningRequested, source);
			sessions.set(sessionKey, resumed);
			return { session: resumed, catchUp: renderCatchUp(plan.missed) };
		}
		const reseeded = openSession(sessionKey, model, reasoningRequested, undefined);
		sessions.set(sessionKey, reseeded);
		return { session: reseeded, catchUp: renderSeed(conversation.slice(0, Math.max(userIndex, 0))) };
	}

	const fresh = openSession(sessionKey, model, reasoningRequested, undefined);
	sessions.set(sessionKey, fresh);
	return { session: fresh, catchUp: renderSeed(plan.transcript) };
}

function persistSyncRecord(sessionKey: string, state: ClaudeSessionState): void {
	const host = getSessionHost(sessionKey);
	if (!host || !state.synced || !state.sdkSessionId) return;
	host.persistRecord({ ...state.synced, piSessionId: sessionKey, sdkSessionId: state.sdkSessionId });
}

function isResumingAfterToolResults(state: ClaudeSessionState, context: TranscriptContext): boolean {
	return state.awaitingToolResults && context.messages[context.messages.length - 1]?.role === "toolResult";
}

export function streamClaudeTurn(
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	stream: AssistantMessageEventStream,
): void {
	const sessionKey = options?.sessionId;
	if (sessionKey === undefined) throw new Error("claude provider: the stream options carry no sessionId");
	const output = createAssistantShell(model);
	const translator = new TurnTranslator(output, stream, (toolUseId) => toolResultBroker.expect(toolUseId, sessionKey));

	let started = false;
	const emitStart = (): void => {
		if (started) return;
		started = true;
		stream.push({ type: "start", partial: output });
	};

	const run = async (): Promise<void> => {
		emitStart();
		const signal = options?.signal;
		let activeSession: ClaudeSessionState | undefined;
		const onAbort = (): void => {
			translator.finish("aborted");
			void activeSession?.sdkQuery.interrupt();
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const existing = sessions.get(sessionKey);
			if (existing) await existing.activeTurn;
			if (signal?.aborted) return;

			const resuming = existing !== undefined && isResumingAfterToolResults(existing, context);
			const conversation = conversationOf(context.messages);
			const prepared = resuming
				? { session: existing, catchUp: undefined }
				: await prepareSession(sessionKey, model, options?.reasoning !== undefined, conversation);
			const session = prepared.session;
			activeSession = session;
			if (signal?.aborted) {
				void session.sdkQuery.interrupt();
				return;
			}
			session.synced = markPrefix(conversation, conversation.length);

			const turn = (async () => {
				if (resuming) {
					deliverPiToolResults(context.messages);
				} else {
					if (session.awaitingToolResults) await abandonPendingRun(sessionKey, session);
					await session.sdkQuery.setModel(model.id);
					const currentAppend = buildSubmodeAppend();
					const submodeNotice = currentAppend === session.appliedSubmodeAppend ? undefined : submodeChangeNotice(currentAppend);
					session.appliedSubmodeAppend = currentAppend;
					const preamble = [submodeNotice, prepared.catchUp].filter((part) => part !== undefined).join("\n\n");
					const userMessage = buildUserMessage(context.messages, sessionKey, preamble || undefined);
					session.pendingUuid = userMessage.uuid;
					session.input.push(userMessage);
				}
				await consumeUntilBoundary(session, translator);
				if (translator.completedNormally) persistSyncRecord(sessionKey, session);
			})();
			session.activeTurn = turn.catch(() => undefined);

			await turn;
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	};

	run().catch((error: unknown) => {
		disposeClaudeSession(sessionKey);
		const message = error instanceof Error ? error.message : String(error);
		if (!translator.finished) {
			emitStart();
			translator.finish("error", message);
		}
	});
}

export interface BackgroundTask {
	readonly taskId: string;
	readonly description: string;
	readonly taskType: string;
	readonly subagentType: string | undefined;
}

export interface CompactOutcome {
	readonly preTokens: number;
	readonly postTokens: number | undefined;
	readonly summary: string | undefined;
}

export type SdkSlashCommand = Awaited<ReturnType<Query["supportedCommands"]>>[number];
export type SdkAgentInfo = Awaited<ReturnType<Query["supportedAgents"]>>[number];
export type SessionMessageListener = (message: SDKMessage) => void;

const backgroundTasksBySession = new Map<string, BackgroundTask[]>();

function requireSession(sessionKey: string): ClaudeSessionState {
	const state = sessions.get(sessionKey);
	if (!state) throw new Error("No active Claude session. Send a message first.");
	return state;
}

function trackBackgroundTasks(sessionKey: string, message: SDKMessage): void {
	if (message.type !== "system" || message.subtype !== "background_tasks_changed") return;
	backgroundTasksBySession.set(
		sessionKey,
		message.tasks
			.filter((task) => task.ambient !== true)
			.map((task) => ({
				taskId: task.task_id,
				description: task.description,
				taskType: task.task_type,
				subagentType: task.subagent_type,
			})),
	);
}

function trackRateLimitHit(sessionKey: string, message: SDKMessage): void {
	if (message.type === "rate_limit_event" && message.rate_limit_info.status === "rejected") {
		recordLimitHit(sessionKey, message.rate_limit_info.resetsAt);
		return;
	}
	if (message.type === "assistant" && message.error === "rate_limit") {
		recordLimitHit(sessionKey, undefined);
		return;
	}
	if (message.type !== "result") return;
	if (!message.is_error) clearLimitHit(sessionKey);
	else if (hasLimitHit(sessionKey)) attachInterruptedAgents(sessionKey, agentProgressRouter.interruptedRuns(sessionKey));
}

function observeSdkMessage(sessionKey: string, state: ClaudeSessionState, message: SDKMessage): void {
	trackBackgroundTasks(sessionKey, message);
	trackRateLimitHit(sessionKey, message);
	if (message.type === "system" && message.subtype === "init") state.sdkSessionId = message.session_id;
	if (message.type === "user" && message.isSynthetic === true) captureCompactionSummary(state, message);
	for (const listener of state.listeners) listener(message);
}

const COMPACTION_SUMMARY_PREFIX = "This session is being continued from a previous conversation";

function captureCompactionSummary(state: ClaudeSessionState, message: Extract<SDKMessage, { type: "user" }>): void {
	const content = message.message.content;
	if (typeof content === "string" && content.startsWith(COMPACTION_SUMMARY_PREFIX)) state.compactionSummary = content;
}

export function observeSessionMessages(sessionKey: string, listener: SessionMessageListener): boolean {
	const state = sessions.get(sessionKey);
	if (!state || state.listeners.has(listener)) return false;
	state.listeners.add(listener);
	return true;
}

export function discardCompactionRebase(sessionKey: string): void {
	const state = sessions.get(sessionKey);
	if (state) state.rebaseNextTurn = false;
}

export function listTasks(sessionKey: string): readonly BackgroundTask[] {
	return backgroundTasksBySession.get(sessionKey) ?? [];
}

export async function stopTask(sessionKey: string, taskId: string): Promise<void> {
	await requireSession(sessionKey).sdkQuery.stopTask(taskId);
}

export async function setSessionModel(sessionKey: string, modelId: string): Promise<boolean> {
	const state = sessions.get(sessionKey);
	if (!state) return false;
	await state.sdkQuery.setModel(modelId);
	return true;
}

export function resetSession(sessionKey: string): boolean {
	const existed = sessions.has(sessionKey);
	disposeClaudeSession(sessionKey);
	return existed;
}

export async function listSdkSlashCommands(sessionKey: string): Promise<SdkSlashCommand[]> {
	return requireSession(sessionKey).sdkQuery.supportedCommands();
}

export async function listSdkAgents(sessionKey: string): Promise<SdkAgentInfo[]> {
	return requireSession(sessionKey).sdkQuery.supportedAgents();
}

export async function compactSession(sessionKey: string, customInstructions: string | undefined): Promise<CompactOutcome | undefined> {
	const state = sessions.get(sessionKey);
	if (!state) return undefined;
	await state.activeTurn;
	if (state.awaitingToolResults) await abandonPendingRun(sessionKey, state);

	const command = customInstructions ? `/compact ${customInstructions}` : "/compact";
	const pushUuid = randomUUID();
	state.pendingUuid = pushUuid;
	const compaction = (async (): Promise<CompactOutcome> => {
		let boundary: Omit<CompactOutcome, "summary"> | undefined;
		state.compactionSummary = undefined;
		state.input.push({
			type: "user",
			message: { role: "user", content: command },
			parent_tool_use_id: null,
			session_id: sessionKey,
			uuid: pushUuid,
		});
		for (;;) {
			const sdkMessage = await nextSdkMessage(state);
			if (sdkMessage.type === "system" && sdkMessage.subtype === "compact_boundary") {
				boundary = {
					preTokens: sdkMessage.compact_metadata.pre_tokens,
					postTokens: sdkMessage.compact_metadata.post_tokens,
				};
			}
			if (sdkMessage.type !== "result") continue;
			if (sdkMessage.is_error) throw new Error(`Claude /compact failed (${sdkMessage.subtype})`);
			if (!boundary) throw new Error("Claude /compact finished without a compaction boundary");
			state.rebaseNextTurn = true;
			return { ...boundary, summary: state.compactionSummary };
		}
	})();
	state.activeTurn = compaction.then(
		() => undefined,
		() => undefined,
	);
	return compaction;
}
