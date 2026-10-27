import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import { CLAUDE_PROVIDER_ID } from "../../../shared/modes.ts";

export const SYNC_ENTRY_TYPE = "claude-sdk-session";

const TOOL_RESULT_CHAR_LIMIT = 1_500;
const TOOL_ARGUMENT_CHAR_LIMIT = 400;
const CATCH_UP_CHAR_BUDGET = 60_000;

export interface SyncMark {
	readonly count: number;
	readonly hash: string;
}

export interface SyncRecord extends SyncMark {
	readonly piSessionId: string;
	readonly sdkSessionId: string;
}

export type SyncPlan =
	| { readonly kind: "in-sync"; readonly missed: Message[] }
	| { readonly kind: "unsynced"; readonly transcript: Message[] };

const digestCache = new WeakMap<Message, string>();

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function describeContent(content: unknown): unknown {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => {
		if (block?.type === "text") return block.text;
		if (block?.type === "toolCall") return { call: block.id, name: block.name };
		if (block?.type === "image") return { image: typeof block.data === "string" ? block.data.length : 0 };
		return null;
	});
}

function digestMessage(message: Message): string {
	const cached = digestCache.get(message);
	if (cached) return cached;
	const toolCallId = message.role === "toolResult" ? message.toolCallId : undefined;
	const digest = sha256(JSON.stringify({ role: message.role, toolCallId, content: describeContent(message.content) }));
	digestCache.set(message, digest);
	return digest;
}

export function conversationOf(messages: readonly Message[]): Message[] {
	return messages.filter((message) => message.role !== "system");
}

export function markPrefix(conversation: readonly Message[], count: number): SyncMark {
	const digests = conversation.slice(0, count).map(digestMessage);
	return { count, hash: sha256(digests.join("\n")) };
}

export function lastUserIndex(conversation: readonly Message[]): number {
	for (let index = conversation.length - 1; index >= 0; index -= 1) {
		if (conversation[index].role === "user") return index;
	}
	return -1;
}

function matchesMark(conversation: readonly Message[], mark: SyncMark): boolean {
	return conversation.length >= mark.count && markPrefix(conversation, mark.count).hash === mark.hash;
}

export function planSync(conversation: readonly Message[], mark: SyncMark | undefined): SyncPlan {
	const userIndex = lastUserIndex(conversation);
	const before = userIndex < 0 ? [] : conversation.slice(0, userIndex);
	if (!mark || !matchesMark(conversation, mark)) return { kind: "unsynced", transcript: before };
	let start = mark.count;
	const ownReply = conversation[start];
	if (ownReply?.role === "assistant" && ownReply.provider === CLAUDE_PROVIDER_ID) start += 1;
	return { kind: "in-sync", missed: conversation.slice(start, Math.max(start, userIndex)) };
}

function truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}... [truncated ${text.length - limit} chars]`;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block?.type === "text" ? block.text : block?.type === "image" ? "[image]" : ""))
		.filter((part) => part.length > 0)
		.join("\n");
}

function renderMessage(message: Message): string {
	switch (message.role) {
		case "user":
			return `[user]\n${textOf(message.content)}`;
		case "assistant": {
			const parts: string[] = [];
			for (const block of message.content) {
				if (block.type === "text") parts.push(block.text);
				else if (block.type === "toolCall") {
					parts.push(`[tool call ${block.name} ${truncate(JSON.stringify(block.arguments), TOOL_ARGUMENT_CHAR_LIMIT)}]`);
				}
			}
			return `[assistant ${message.provider}/${message.model}]\n${parts.join("\n")}`;
		}
		case "toolResult":
			return `[tool result ${message.toolName}${message.isError ? " (error)" : ""}]\n${truncate(textOf(message.content), TOOL_RESULT_CHAR_LIMIT)}`;
		default:
			return "";
	}
}

function renderWithinBudget(messages: readonly Message[]): string {
	const rendered = messages.map(renderMessage).filter((entry) => entry.length > 0);
	const kept: string[] = [];
	let used = 0;
	for (let index = rendered.length - 1; index >= 0; index -= 1) {
		if (used + rendered[index].length > CATCH_UP_CHAR_BUDGET && kept.length > 0) break;
		kept.unshift(rendered[index]);
		used += rendered[index].length;
	}
	const omitted = rendered.length - kept.length;
	const header = omitted > 0 ? `[${omitted} earlier messages omitted]\n\n` : "";
	return header + kept.join("\n\n");
}

export function renderCatchUp(messages: readonly Message[]): string | undefined {
	if (messages.length === 0) return undefined;
	return [
		"<system-reminder>",
		"These turns happened outside this Claude session, handled by another model or edited in pi. They are context only: do not answer them or redo their work.",
		"",
		renderWithinBudget(messages),
		"</system-reminder>",
	].join("\n");
}

export function renderSeed(transcript: readonly Message[]): string | undefined {
	if (transcript.length === 0) return undefined;
	return [
		"<system-reminder>",
		"This is a new Claude session continuing an existing pi conversation. The transcript so far follows. It is context only: do not answer it or redo its work.",
		"",
		renderWithinBudget(transcript),
		"</system-reminder>",
	].join("\n");
}

export function isSyncRecord(value: unknown): value is SyncRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.piSessionId === "string" &&
		typeof record.sdkSessionId === "string" &&
		typeof record.hash === "string" &&
		typeof record.count === "number"
	);
}
