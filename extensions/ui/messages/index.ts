/**
 * messages — a unified look for tool calls.
 *
 * Built-in tool calls drop their full background for a heavy left rule (`│`)
 * colored with the tool's semantic status color as a bright pastel. Rendering
 * only: no tool behavior or model context changes. Enable or disable it with
 * `/couralabs:enable messages` and `/couralabs:disable messages`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { wrapRenderers } from "./renderers.ts";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("messages");

	// Swap the built-in shell for a left rule, without touching tool behavior.
	pi.registerToolRenderer((_, next) => {
		const renderers = next();
		if (!renderers) return renderers;
		return wrapRenderers(renderers);
	});
}
