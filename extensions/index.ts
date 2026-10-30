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
import sessionDashboard from "./tools/session-dashboard/index.ts";
import spawn from "./tools/spawn/index.ts";
import timer from "./tools/timer/index.ts";
import web from "./tools/web/index.ts";

import { withClaudeCommandRedirects } from "./providers/claude/commands.ts";
import claude from "./providers/claude/index.ts";

export default function piAdhd(pi: ExtensionAPI): void {

	resetExtensionRegistry();

	registerExtensionControlCommands(pi);

	const enabled = loadEnabledExtensions();

	if (enabled.has("editor")) editor(pi);
	if (enabled.has("footer")) footer(pi);
	if (enabled.has("messages")) messages(pi);
	if (enabled.has("thinking")) thinking(pi);
if (enabled.has("session-title")) sessionTitle(pi);

	if (enabled.has("modes")) modes(pi);
	if (enabled.has("submodes")) submodes(pi);
	if (enabled.has("commands")) commands(pi);

	if (enabled.has("ask-user")) askUser(pi);
	const toolsApi = enabled.has("claude") ? withClaudeCommandRedirects(pi) : pi;
	if (enabled.has("job")) job(toolsApi);
	if (enabled.has("pomodoro")) pomodoro(pi);
	if (enabled.has("session-dashboard")) sessionDashboard(pi);
	if (enabled.has("spawn")) spawn(toolsApi);
	if (enabled.has("timer")) timer(pi);
	if (enabled.has("web")) web(pi);

	if (enabled.has("claude")) claude(pi);
}
