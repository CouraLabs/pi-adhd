import type { Api, AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { AGY_SYNC_ENTRY_TYPE } from "./identity.ts";
import { extractAgyPrompt } from "./prompt.ts";
import { runAgyTurn } from "./runner.ts";
import { getAgySessionHost, takeAgyRestoredRecord } from "./session-host.ts";
import { buildAgySubmodeAppend } from "./submode.ts";
import { AgyTurnTranslator, createAgyAssistantShell } from "./translate.ts";
import type { AgySyncRecord } from "./identity.ts";

interface AgySessionState {
	conversationId: string | undefined;
	modelId: string | undefined;
	activeTurn: Promise<void>;
	appliedSubmodeAppend: string | undefined;
}

const sessions = new Map<string, AgySessionState>();

export function persistAgyRecord(sessionKey: string, record: AgySyncRecord): void {
	getAgySessionHost(sessionKey)?.persistRecord(record);
}

function ensureSession(sessionKey: string): AgySessionState {
	const existing = sessions.get(sessionKey);
	if (existing) return existing;
	const restored = takeAgyRestoredRecord(sessionKey);
	const created: AgySessionState = {
		conversationId: restored?.conversationId,
		modelId: restored?.modelId,
		activeTurn: Promise.resolve(),
		appliedSubmodeAppend: undefined,
	};
	sessions.set(sessionKey, created);
	return created;
}

function renderSeedTranscript(messages: { role: string; text: string }[]): string | undefined {
	const prior = messages.slice(0, -1).filter((message) => message.text.trim().length > 0);
	if (prior.length === 0) return undefined;
	const rendered = prior
		.map((message) => `[${message.role}]\n${message.text.slice(0, 4000)}`)
		.join("\n\n")
		.slice(-20_000);
	return `<context>\nThis is a continuing pi conversation. Earlier turns follow as context only; answer only the latest user message.\n\n${rendered}\n</context>`;
}

function describeTranscript(messages: TranscriptContext["messages"]): { role: string; text: string }[] {
	return messages
		.map((message) => {
			if (message.role === "user") {
				const content = typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
				return { role: "user", text: content };
			}
			if (message.role === "assistant") {
				const text = message.content.map((block) => (block.type === "text" ? block.text : block.type === "thinking" ? block.thinking : `[tool ${block.name}]`)).join("\n");
				return { role: "assistant", text };
			}
			return undefined;
		})
		.filter((entry): entry is { role: string; text: string } => entry !== undefined);
}

function buildPreamble(session: AgySessionState, messages: TranscriptContext["messages"]): string | undefined {
	const currentAppend = buildAgySubmodeAppend();
	const submodeNotice =
		currentAppend === session.appliedSubmodeAppend
			? undefined
			: currentAppend === undefined
				? "<system-reminder>The previous submode has ended. Its instructions and tool restrictions no longer apply.</system-reminder>"
				: `<system-reminder>The active submode changed. These instructions replace any earlier submode instructions:\n\n${currentAppend}</system-reminder>`;
	session.appliedSubmodeAppend = currentAppend;
	const seed = session.conversationId === undefined ? renderSeedTranscript(describeTranscript(messages)) : undefined;
	return [submodeNotice, seed].filter((part) => part !== undefined).join("\n\n") || undefined;
}

export function streamAgyTurn(
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	stream: AssistantMessageEventStream,
): void {
	const sessionKey = options?.sessionId;
	if (sessionKey === undefined) throw new Error("agy provider: the stream options carry no sessionId");
	const output = createAgyAssistantShell(model);
	const translator = new AgyTurnTranslator(output, stream);
	let started = false;
	const emitStart = (): void => {
		if (started) return;
		started = true;
		stream.push({ type: "start", partial: output });
	};

	const run = async (): Promise<void> => {
		emitStart();
		const signal = options?.signal;
		if (signal?.aborted) {
			translator.finishAborted();
			return;
		}
		const session = ensureSession(sessionKey);
		await session.activeTurn;
		if (signal?.aborted) {
			translator.finishAborted();
			return;
		}
		const turn = (async () => {
			const host = getAgySessionHost(sessionKey);
			const cwd = host?.cwd ?? process.cwd();
			const preamble = buildPreamble(session, context.messages);
			const prompt = extractAgyPrompt(context.messages, preamble);
			const outcome = await runAgyTurn({
				prompt,
				modelId: model.id,
				conversationId: session.conversationId,
				cwd,
				signal,
				onEvent: (event) => translator.handle(event),
			});
			session.conversationId = outcome.conversationId;
			session.modelId = model.id;
			const hostAfter = getAgySessionHost(sessionKey);
			hostAfter?.persistRecord({ piSessionId: sessionKey, conversationId: outcome.conversationId, modelId: model.id });
			translator.finishWithResult(outcome.result, outcome.stderr, model);
		})();

		session.activeTurn = turn.catch(() => undefined);
		await turn;
	};

	run().catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		if (options?.signal?.aborted) translator.finishAborted(message);
		else translator.finishError(message);
	});
}

export function disposeAgySession(sessionKey: string): void {
	sessions.delete(sessionKey);
}

export function resetAgySession(sessionKey: string): boolean {
	const existed = sessions.has(sessionKey);
	sessions.delete(sessionKey);
	return existed;
}

export function setAgySessionModel(sessionKey: string, modelId: string): boolean {
	const session = sessions.get(sessionKey);
	if (!session) return false;
	session.modelId = modelId;
	return true;
}

export function getAgyConversationId(sessionKey: string): string | undefined {
	return sessions.get(sessionKey)?.conversationId;
}

export { AGY_SYNC_ENTRY_TYPE };
export type { AgySyncRecord };
