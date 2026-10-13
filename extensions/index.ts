/**
 * pi-adhd — single entry point that loads the enabled bundled extensions.
 *
 * Each extension keeps its own default factory and stays individually loadable
 * (`pi -e extensions/tools/todo/index.ts`); this barrel wires them into one
 * path so the package can be loaded from a single manifest entry. It reads the
 * top-level `extensions` array in `~/.pi/couralabs/settings.json` and calls
 * only the listed factories, so an extension absent from the array is never
 * loaded. `/couralabs:enable <extension>` and `/couralabs:disable <extension>`
 * edit that array and reload.
 *
 * Load order is deliberate and matches the previous manifest glob order:
 *   ui → agent → tools
 * The one hard constraint is `submodes` before `todo`: both add a
 * `before_agent_start` handler, and submodes' tool-policy re-assert must run
 * first so todo's upkeep section is dropped when the submode excludes `todo`
 * (see extensions/tools/todo/index.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadEnabledExtensions, registerExtensionControlCommands } from "../shared/extension-control.ts";
import { resetExtensionRegistry } from "../shared/extension-registry.ts";

import editor from "./ui/editor/index.ts";
import footer from "./ui/footer/index.ts";
import messages from "./ui/messages/index.ts";
import thinking from "./ui/thinking/index.ts";

import modes from "./agent/modes/index.ts";
import submodes from "./agent/submodes/index.ts";

import askUser from "./tools/ask-user/index.ts";
import goal from "./tools/goal/index.ts";
import spawn from "./tools/spawn/index.ts";
import todo from "./tools/todo/index.ts";
import web from "./tools/web/index.ts";

export default function piAdhd(pi: ExtensionAPI): void {
	// Reflect the settings the operator just saved, not a previous load's marks.
	resetExtensionRegistry();

	// Always available, whatever the settings enable, so a disabled extension
	// can be turned back on.
	registerExtensionControlCommands(pi);

	const enabled = loadEnabledExtensions();

	// UI: editor, footer, tool-call rendering, thinking display.
	if (enabled.has("editor")) editor(pi);
	if (enabled.has("footer")) footer(pi);
	if (enabled.has("messages")) messages(pi);
	if (enabled.has("thinking")) thinking(pi);

	// Agent behavior: Pi/Work mode + Plan/Grill/Straight submodes.
	if (enabled.has("modes")) modes(pi);
	if (enabled.has("submodes")) submodes(pi);

	// Tools: ask, goal, spawn, todo, web.
	if (enabled.has("ask-user")) askUser(pi);
	if (enabled.has("goal")) goal(pi);
	if (enabled.has("spawn")) spawn(pi);
	if (enabled.has("todo")) todo(pi);
	if (enabled.has("web")) web(pi);
}
