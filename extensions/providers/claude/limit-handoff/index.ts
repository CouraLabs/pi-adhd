import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLimitHandoffCommand } from "./command.ts";
import { createLimitHandoff } from "./handoff.ts";
import { clearLimitHit } from "./pending-limit.ts";

export function registerLimitHandoff(pi: ExtensionAPI): void {
	registerLimitHandoffCommand(pi);
	const handoff = createLimitHandoff(pi);

	pi.on("agent_start", () => handoff.cancelWait());
	pi.on("agent_settled", (event, context) => {
		if (event.aborted) {
			clearLimitHit(context.sessionManager.getSessionId());
			return;
		}
		void handoff.handleSettled(context);
	});
	pi.on("session_shutdown", (_event, context) => {
		handoff.cancelWait();
		clearLimitHit(context.sessionManager.getSessionId());
	});
}
