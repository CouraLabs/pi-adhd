import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { wrapRenderers } from "./renderers.ts";
import { flattenUserMessage } from "./user-padding.ts";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("messages");

	let activeTheme: Theme | undefined;
	flattenUserMessage(() => activeTheme);
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) activeTheme = ctx.ui.theme;
	});

	pi.registerToolRenderer((toolName, next) => {
		const renderers = next();
		if (!renderers) return renderers;
		return wrapRenderers(toolName, renderers);
	});
}
