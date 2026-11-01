import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { observeSessionMessages } from "./bridge.ts";

type NotifyLevel = "info" | "warning" | "error";

export interface SdkEventNotice {
	readonly text: string;
	readonly level: NotifyLevel;
}

const REFUSAL_SCOPE_NOTE: Record<string, string> = {
	session: "",
	local: " (this reply only)",
};

function noticeOf(text: string, level: NotifyLevel): SdkEventNotice {
	return { text, level };
}

function refusalExplanation(explanation: string | null | undefined): string {
	return typeof explanation === "string" && explanation.length > 0 ? ` — ${explanation}` : "";
}

export function sdkEventNotice(message: SDKMessage): SdkEventNotice | undefined {
	if (message.type === "system") {
		switch (message.subtype) {
			case "api_retry": {
				const status = message.error_status === null ? "no response" : `HTTP ${message.error_status}`;
				return noticeOf(`Claude API error (${status}) — retrying, attempt ${message.attempt}/${message.max_retries}`, "info");
			}
			case "model_refusal_fallback":
				return noticeOf(
					`Claude refused on ${message.original_model}; switching to ${message.fallback_model}${REFUSAL_SCOPE_NOTE[message.scope ?? "session"] ?? ""}${refusalExplanation(message.api_refusal_explanation)}`,
					"warning",
				);
			case "model_refusal_no_fallback":
				return noticeOf(
					`Claude refused on ${message.original_model} and no fallback model is available${refusalExplanation(message.api_refusal_explanation)}`,
					"error",
				);
			case "notification":
				return noticeOf(message.text, message.priority === "high" || message.priority === "immediate" ? "warning" : "info");
			case "informational":
				return noticeOf(message.content, message.level === "warning" ? "warning" : "info");
			case "permission_denied":
				return noticeOf(message.message, "warning");
			case "mirror_error":
				return noticeOf(`Claude session mirror error: ${message.error}`, "warning");
			case "plugin_install":
				if (message.status !== "failed") return undefined;
				return noticeOf(`${message.name ?? "Claude plugin"} install failed: ${message.error ?? "unknown error"}`, "warning");
			case "status":
				if (message.compact_result !== "failed") return undefined;
				return noticeOf(`Claude /compact failed: ${message.compact_error ?? "unknown error"}`, "error");
			default:
				return undefined;
		}
	}
	if (message.type === "auth_status" && message.error) return noticeOf(`Claude authentication failed: ${message.error}`, "error");
	if (message.type === "conversation_reset") {
		return noticeOf(`Claude conversation was reset${message.trigger ? ` (${message.trigger})` : ""} — the next turn reseeds context from the pi transcript.`, "warning");
	}
	return undefined;
}

let currentContext: ExtensionContext | undefined;
let lastNoticeText: string | undefined;

function onSdkEvent(message: SDKMessage): void {
	const notice = sdkEventNotice(message);
	if (!notice || notice.text === lastNoticeText) return;
	lastNoticeText = notice.text;
	const context = currentContext;
	if (!context) return;
	if (context.hasUI) {
		context.ui.notify(notice.text, notice.level);
		return;
	}
	console.error(notice.text);
}

export function attachSdkEventNotices(sessionKey: string, context: ExtensionContext): boolean {
	currentContext = context;
	return observeSessionMessages(sessionKey, onSdkEvent);
}
