import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGY_PROVIDER_ID } from "../../../shared/modes.ts";
import { getAgyConversationId, resetAgySession, setAgySessionModel } from "./bridge.ts";

function isAgyActive(context: ExtensionContext): boolean {
	return context.model?.provider === AGY_PROVIDER_ID;
}

function sessionKeyOf(context: ExtensionContext): string {
	return context.sessionManager.getSessionId();
}

export function registerAgyCommands(pi: ExtensionAPI): void {
	pi.registerCommand("agy:new", {
		description: "Start a fresh agy conversation (drops the resumed --conversation id)",
		handler: async (_args, context) => {
			const reset = resetAgySession(sessionKeyOf(context));
			context.ui.notify(reset ? "agy conversation reset. The next turn starts a new conversation." : "No agy conversation to reset.", "info");
		},
	});

	pi.registerCommand("agy:info", {
		description: "Show the agy conversation id for this session",
		handler: async (_args, context) => {
			const conversationId = getAgyConversationId(sessionKeyOf(context));
			context.ui.notify(conversationId ? `agy conversation: ${conversationId}` : "No agy conversation yet. Send a message first.", "info");
		},
	});

	pi.on("session_before_compact", async (_event, context) => {
		if (!isAgyActive(context)) return undefined;
		resetAgySession(sessionKeyOf(context));
		return undefined;
	});

	pi.on("session_shutdown", (event, context) => {
		if (event.reason !== "new") return;
		resetAgySession(sessionKeyOf(context));
	});

	pi.on("model_select", async (event, context) => {
		if (event.model.provider !== AGY_PROVIDER_ID) return;
		try {
			setAgySessionModel(sessionKeyOf(context), event.model.id);
		} catch {
			return;
		}
	});
}
