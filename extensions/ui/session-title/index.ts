import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { registerSessionTitleCommand } from "./command.ts";
import { loadSessionTitleConfig } from "./config.ts";
import { generateSessionTitle, resolveTitleModel } from "./generator.ts";

interface PendingRun {
	prompt: string;
	controller: AbortController;
}

const pending = new Map<string, PendingRun>();

function sessionKey(context: ExtensionContext): string {
	return context.sessionManager.getSessionFile() ?? context.sessionManager.getSessionId();
}

async function nameSession(pi: ExtensionAPI, context: ExtensionContext): Promise<void> {
	const sessionFile = sessionKey(context);
	const run = pending.get(sessionFile);
	if (!run) return;
	pending.delete(sessionFile);

	const config = loadSessionTitleConfig();
	if (!config.enabled) return;
	if (context.sessionManager.getSessionName()) return;
	const model = resolveTitleModel(context.modelRegistry, config.model, context.model);
	if (!model) return;

	const title = await generateSessionTitle(model, context.modelRegistry, run.prompt, run.controller.signal);
	if (run.controller.signal.aborted) return;
	if (title) pi.setSessionName(title);
}

export default function sessionTitle(pi: ExtensionAPI): void {
	markExtensionLoaded("session-title");
	registerSessionTitleCommand(pi);

	pi.on("before_agent_start", (event, context) => {
		if (event.messageType !== "user") return;
		if (isChildSession(context.sessionManager.getSessionId())) return;
		const sessionFile = sessionKey(context);
		pending.get(sessionFile)?.controller.abort();
		pending.set(sessionFile, { prompt: event.prompt, controller: new AbortController() });
	});

	pi.on("agent_end", (_event, context) => {
		void nameSession(pi, context);
	});

	pi.on("session_shutdown", (_event, context) => {
		const sessionFile = sessionKey(context);
		pending.get(sessionFile)?.controller.abort();
		pending.delete(sessionFile);
	});
}
