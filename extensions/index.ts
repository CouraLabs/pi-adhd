/**
 * pi-adhd — single entry point that loads the enabled bundled extensions.
 *
 * Each extension keeps its own default factory and stays individually loadable
 * (`pi -e extensions/tools/web/index.ts`); this barrel wires them into one
 * path so the package can be loaded from a single manifest entry. It reads the
 * top-level `extensions` array in `~/.pi/couralabs/settings.json` and calls
 * only the listed factories, so an extension absent from the array is never
 * loaded. `/couralabs:toggle <extension>` flips an extension in that array and
 * reloads the set.
 *
 * Load order is deliberate and matches the previous manifest glob order:
 *   ui → agent → tools → providers
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadEnabledExtensions, registerExtensionControlCommands } from "../shared/extension-control.ts";
import { resetExtensionRegistry } from "../shared/extension-registry.ts";

import editor from "./ui/editor/index.ts";
import footer from "./ui/footer/index.ts";
import messages from "./ui/messages/index.ts";
import thinking from "./ui/thinking/index.ts";
import sessionTitle from "./ui/session-title/index.ts";

import commands from "./agent/commands/index.ts";
import modes from "./agent/modes/index.ts";
import submodes from "./agent/submodes/index.ts";

import askUser from "./tools/ask-user/index.ts";
import job from "./tools/job/index.ts";
import pomodoro from "./tools/pomodoro/index.ts";
import spawn from "./tools/spawn/index.ts";
import timer from "./tools/timer/index.ts";
import web from "./tools/web/index.ts";

import { withClaudeCommandRedirects } from "./providers/claude/commands.ts";
import claude from "./providers/claude/index.ts";

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
if (enabled.has("session-title")) sessionTitle(pi);

	// Agent behavior: Pi/Work mode + Plan/Grill/Straight submodes + prompt commands.
	if (enabled.has("modes")) modes(pi);
	if (enabled.has("submodes")) submodes(pi);
	if (enabled.has("commands")) commands(pi);

	// Tools: ask, job, pomodoro, spawn, timer, web.
	if (enabled.has("ask-user")) askUser(pi);
	const toolsApi = enabled.has("claude") ? withClaudeCommandRedirects(pi) : pi;
	if (enabled.has("job")) job(toolsApi);
	if (enabled.has("pomodoro")) pomodoro(pi);
	if (enabled.has("spawn")) spawn(toolsApi);
	if (enabled.has("timer")) timer(pi);
	if (enabled.has("web")) web(pi);

	// Providers: Claude Agent SDK.
	if (enabled.has("claude")) claude(pi);
}
