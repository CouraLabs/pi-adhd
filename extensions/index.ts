/**
 * pi-adhd — single entry point that loads every bundled extension.
 *
 * Each extension keeps its own default factory and stays individually loadable
 * (`pi -e extensions/tools/todo/index.ts`); this barrel only wires them into
 * one path so the package can be loaded from a single manifest entry. Calling
 * the factories directly is the same as pi loading each file: they register
 * their tools, commands, and event handlers against the shared `ExtensionAPI`.
 *
 * Load order is deliberate and matches the previous manifest glob order:
 *   ui → agent → tools
 * The one hard constraint is `submodes` before `todo`: both add a
 * `before_agent_start` handler, and submodes' tool-policy re-assert must run
 * first so todo's upkeep section is dropped when the submode excludes `todo`
 * (see extensions/tools/todo/index.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
	// UI: editor, footer, tool-call rendering, thinking display.
	editor(pi);
	footer(pi);
	messages(pi);
	thinking(pi);

	// Agent behavior: Pi/Work mode + Plan/Grill/Straight submodes.
	modes(pi);
	submodes(pi);

	// Tools: ask, goal, spawn, todo, web.
	askUser(pi);
	goal(pi);
	spawn(pi);
	todo(pi);
	web(pi);
}
