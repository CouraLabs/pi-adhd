/**
 * messages — a unified look for tool calls and user prompts.
 *
 * Tool calls render inline: a status-colored pick glyph (⛏) before the call —
 * warning while the call is mere paperwork, accent while running, error or
 * success once settled — with the tool name rewritten to PascalCase in the
 * renderer's own style. Full backgrounds and left rules stay off. User prompts
 * lose their floating background box and gain a default-foreground left rule.
 * Rendering only: no tool behavior or model context changes. Toggle it with
 * `/couralabs:toggle messages`.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { wrapRenderers } from "./renderers.ts";
import { flattenUserMessage } from "./user-padding.ts";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("messages");

	// Restyle the user prompt. The theme arrives with the session: pi installs
	// extensions before the first session_start, and the getter keeps the rule
	// reading whatever theme is live at render time.
	let activeTheme: Theme | undefined;
	flattenUserMessage(() => activeTheme);
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) activeTheme = ctx.ui.theme;
	});

	// Frame every tool's calls inline, without touching tool behavior. The
	// tool name travels with the renderers: the header rewrite is keyed on it.
	pi.registerToolRenderer((toolName, next) => {
		const renderers = next();
		if (!renderers) return renderers;
		return wrapRenderers(toolName, renderers);
	});
}
