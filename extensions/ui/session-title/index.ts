/**
 * session-title — names each session after its last user prompt.
 *
 * The first time a run settles in a session that has no name, the extension
 * asks the configured model for a short title generated from that run's user
 * prompt, then sets it as the session's display name (the name the session
 * selector shows). A session is named once: once a name exists — user-set or
 * previously generated — the extension stays out of the way. Spawned child
 * sessions are skipped: children are ephemeral and already carry the spawning
 * prompt's wording.
 *
 * The generating model is `/couralabs:session-title`'s pick, stored as
 * `provider/id` under the `sessionTitle` key of the pi-adhd settings file;
 * with no override, the session's current model writes the title. The
 * on/off switch is `/couralabs:toggle session-title`.
 *
 * Runs are keyed by session file, so two sessions in one process never
 * consume each other's prompts, and a run that starts while a title is still
 * being generated aborts the pending call instead of naming from a stale
 * prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isChildSession } from "../../../shared/child-sessions.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { registerSessionTitleCommand } from "./command.ts";
import { loadSessionTitleConfig } from "./config.ts";
import { generateSessionTitle, resolveTitleModel } from "./generator.ts";

/** One captured prompt plus the handle that cancels its naming call. */
interface PendingRun {
	prompt: string;
	controller: AbortController;
}

/** Session file → the run whose prompt names the session. */
const pending = new Map<string, PendingRun>();

/** Stable per-session key; the file may be undefined before the first write,
 *  so the id backs it up. Both are unique per session. */
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
	if (context.sessionManager.getSessionName()) return; // already named; never overwrite
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
