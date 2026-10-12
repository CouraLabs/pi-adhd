/**
 * messages — a unified look for tool calls.
 *
 * Built-in tool calls drop their full background for a heavy left rule (`│`)
 * colored with the tool's semantic status color as a bright pastel. Rendering
 * only: no tool behavior or model context changes. Toggle with
 * `/messages-ui [on|off]`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadSettings, updateSettings } from "../../shared/settings.ts";
import { wrapRenderers } from "./renderers.ts";

export default function (pi: ExtensionAPI) {
	let enabled = true;

	// Swap the built-in shell for a left rule, without touching tool behavior.
	pi.registerToolRenderer((_, next) => {
		if (!enabled) return next();
		const renderers = next();
		if (!renderers) return renderers;
		return wrapRenderers(renderers);
	});

	pi.registerCommand("messages-ui", {
		description:
			"Toggle the Coura Labs message UI: left status rules on tool calls (usage: /messages-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			updateSettings({ messages: { enabled } });

			commandCtx.ui.notify(
				enabled ? "Coura Labs message UI enabled" : "Default message UI restored",
				"info",
			);
		},
	});

	pi.on("session_start", () => {
		enabled = loadSettings().messages.enabled;
	});
}
