/**
 * messages — a unified look for tool calls.
 *
 * Tool calls render inline: a status-colored pick glyph (⛏) before the call —
 * warning while the call is mere paperwork, accent while running, error or
 * success once settled — with the tool name rewritten to PascalCase in the
 * renderer's own style. Full backgrounds and left rules stay off. Rendering
 * only: no tool behavior or model context changes. Toggle it with
 * `/couralabs:toggle messages`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { wrapRenderers } from "./renderers.ts";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("messages");

	// Frame every tool's calls inline, without touching tool behavior. The
	// tool name travels with the renderers: the header rewrite is keyed on it.
	pi.registerToolRenderer((toolName, next) => {
		const renderers = next();
		if (!renderers) return renderers;
		return wrapRenderers(toolName, renderers);
	});
}
