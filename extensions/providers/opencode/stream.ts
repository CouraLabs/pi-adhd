import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
	Api,
	AssistantMessageEventStream,
	Message,
	Model,
	SimpleStreamOptions,
	SystemMessage,
	TextContent,
	TranscriptContext,
} from "@earendil-works/pi-ai";
import { OPENCODE_ANONYMOUS_KEY, OPENCODE_ENV_ENVELOPE, isOpencodeFreeId, opencodeHeaders } from "./identity.ts";

function systemText(content: SystemMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

function withEnvelopeText(text: string): string {
	if (text.includes(OPENCODE_ENV_ENVELOPE)) return text;
	if (text.length === 0) return OPENCODE_ENV_ENVELOPE;
	return `${OPENCODE_ENV_ENVELOPE}\n\n${text}`;
}

function envelopeContent(content: SystemMessage["content"]): SystemMessage["content"] {
	if (typeof content === "string") return withEnvelopeText(content);
	const first = content[0];
	if (first && first.type === "text") {
		return [{ type: "text", text: withEnvelopeText(first.text) }, ...content.slice(1)] as TextContent[];
	}
	return [{ type: "text", text: withEnvelopeText("") }, ...content] as TextContent[];
}

function applyEnvelope(messages: Message[]): Message[] {
	let applied = false;
	return messages.map((message) => {
		if (applied || message.role !== "system") return message;
		applied = true;
		const system = message as SystemMessage;
		return { ...system, content: envelopeContent(system.content) };
	});
}

function hasUserOrTool(messages: Message[]): boolean {
	return messages.some((message) => message.role === "user" || message.role === "toolResult");
}

export function sanitizeOpencodeMessages(messages: Message[]): Message[] {
	const cleaned: Message[] = [];
	for (const message of messages) {
		if (message.role !== "system" && message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		if (message.role === "assistant" && !hasUserOrTool(cleaned)) continue;
		const previous = cleaned[cleaned.length - 1];
		if (message.role === "assistant" && previous?.role === "assistant") {
			cleaned.push({ role: "user", content: " ", timestamp: Date.now() });
		}
		cleaned.push(message);
	}
	const last = cleaned[cleaned.length - 1];
	if (last?.role === "assistant") cleaned.push({ role: "user", content: " ", timestamp: Date.now() });
	return cleaned;
}

export function buildOpencodeContext(context: TranscriptContext, anonymous: boolean): TranscriptContext {
	const sanitized = sanitizeOpencodeMessages([...context.messages]);
	const enveloped = anonymous ? applyEnvelope(sanitized) : sanitized;
	return { messages: enveloped } as TranscriptContext;
}

export function systemPromptCarriesEnvelope(messages: Message[]): boolean {
	const first = messages.find((message) => message.role === "system");
	if (!first) return false;
	return systemText((first as SystemMessage).content).includes(OPENCODE_ENV_ENVELOPE);
}

export function createOpencodeStreamSimple(anonymous: boolean) {
	return (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();
		void runOpencodeStream(model, context, options, stream, anonymous);
		return stream;
	};
}

async function runOpencodeStream(
	model: Model<Api>,
	context: TranscriptContext,
	options: SimpleStreamOptions | undefined,
	stream: AssistantMessageEventStream,
	anonymous: boolean,
): Promise<void> {
	try {
		const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-completions");
		const headers = opencodeHeaders(options?.headers as Record<string, string> | undefined);
		const requestOptions: SimpleStreamOptions = {
			...options,
			headers,
			...(anonymous ? { apiKey: OPENCODE_ANONYMOUS_KEY } : {}),
		};
		const normalizedModel = { ...model, api: "openai-completions" as const, baseUrl: model.baseUrl };
		const upstream = streamSimple(normalizedModel, buildOpencodeContext(context, anonymous && isOpencodeFreeId(model.provider)), requestOptions);
		for await (const event of upstream) stream.push(event);
		stream.end(await upstream.result());
	} catch (error) {
		const failure = {
			role: "assistant" as const,
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "error" as const,
			errorMessage: error instanceof Error ? error.message : String(error),
			timestamp: Date.now(),
		};
		stream.push({ type: "start", partial: failure });
		stream.push({ type: "error", reason: "error", error: failure });
		stream.end();
	}
}
