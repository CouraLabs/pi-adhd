/**
 * editor — a closed, field-style prompt editor for pi.
 *
 * Wraps the built-in editor in a field-style box drawn with terminal box
 * characters, with a `❯` marker on the first input line. The streaming working
 * indicator is embedded in the top border and the working directory + git
 * state in the bottom border; the box border follows the active agent mode
 * rather than the thinking level. The "Working" label is replaced with a random
 * short joke phrase chosen fresh on every turn.
 *
 * Toggle it with `/couralabs:toggle editor`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadSettings, updateSettings } from "../../../shared/settings.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { agentModeBorderColor, getAgentMode, subscribeAgentMode } from "../../../shared/modes.ts";
import { FieldEditor, type LocationProvider } from "./field-editor.ts";
import { emptyGit, parseNumstat, type GitInfo } from "./git.ts";
import { LOADING_PHRASES } from "./phrases.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

const GIT_REFRESH_INTERVAL_MS = 10_000;
const GIT_DEBOUNCE_MS = 350;

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("editor");
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let fullCwd = false;
	let lastJoke = -1;
	let git: GitInfo = emptyGit();
	let unsubscribeMode: (() => void) | undefined;

	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let gitInterval: ReturnType<typeof setInterval> | undefined;

	const requestRender = () => tui?.requestRender();
	const isTui = () => ctx?.mode === "tui";

	const refreshGit = async () => {
		const c = ctx;
		if (!c) return;
		try {
			const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd: c.cwd });
			// `git diff HEAD` fails on a repository with no commits; fall back to the worktree diff.
			let diffResult = await pi.exec("git", ["diff", "--numstat", "HEAD"], { cwd: c.cwd });
			if (diffResult.code !== 0) {
				diffResult = await pi.exec("git", ["diff", "--numstat"], { cwd: c.cwd });
			}
			const branch = branchResult.code === 0 ? branchResult.stdout.trim() || null : null;
			const { additions, removals } =
				diffResult.code === 0 ? parseNumstat(diffResult.stdout) : { additions: 0, removals: 0 };
			git = { branch, additions, removals };
		} catch {
			git = emptyGit();
		}
		requestRender();
	};

	const scheduleGitRefresh = () => {
		if (!isTui()) return;
		if (gitTimer) clearTimeout(gitTimer);
		gitTimer = setTimeout(() => {
			gitTimer = undefined;
			void refreshGit();
		}, GIT_DEBOUNCE_MS);
	};

	const stopGitTimers = () => {
		if (gitTimer) {
			clearTimeout(gitTimer);
			gitTimer = undefined;
		}
		if (gitInterval) {
			clearInterval(gitInterval);
			gitInterval = undefined;
		}
	};

	const locationProvider: LocationProvider = () => {
		const c = ctx;
		if (!c) return undefined;
		return { cwd: c.cwd, git, theme: c.ui.theme, fullCwd };
	};

	/** Install the dot spinner, colored to match the editor's mode-colored border. */
	const applyWorkingIndicator = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		const border = agentModeBorderColor(getAgentMode());
		const color = (text: string) => context.ui.theme.fg(border, text);
		context.ui.setWorkingIndicator({
			frames: SPINNER_FRAMES.map((frame) => color(frame)),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	};

	const pickJoke = (): string => {
		if (LOADING_PHRASES.length === 0) return "Working";
		let index = Math.floor(Math.random() * LOADING_PHRASES.length);
		if (LOADING_PHRASES.length > 1 && index === lastJoke) index = (index + 1) % LOADING_PHRASES.length;
		lastJoke = index;
		return LOADING_PHRASES[index] ?? "Working";
	};

	const installEditor = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setEditorComponent((editorTui, theme, keybindings) => {
			tui = editorTui;
			return new FieldEditor(editorTui, theme, keybindings, locationProvider);
		});
		applyWorkingIndicator(context);
	};

	pi.registerCommand("full-cwd", {
		description: "Toggle the full working directory in the prompt field (usage: /full-cwd [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") fullCwd = true;
			else if (arg === "off") fullCwd = false;
			else fullCwd = !fullCwd;

			updateSettings({ editor: { fullCwd } });
			requestRender();
			commandCtx.ui.notify(
				fullCwd ? "Showing full working directory" : "Showing last folder of working directory",
				"info",
			);
		},
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		const settings = loadSettings();
		fullCwd = settings.editor.fullCwd;
		git = emptyGit();
		stopGitTimers();

		// Recolor the box border (and spinner) when the agent mode changes.
		unsubscribeMode?.();
		unsubscribeMode = subscribeAgentMode(() => {
			requestRender();
			if (ctx) applyWorkingIndicator(ctx);
		});

		if (context.mode !== "tui") return;
		installEditor(context);
		void refreshGit();
		gitInterval = setInterval(() => void refreshGit(), GIT_REFRESH_INTERVAL_MS);
	});

	// Swap in a new joke phrase for every turn and refresh the spinner colors.
	pi.on("turn_start", () => {
		if (!ctx || ctx.mode !== "tui") return;
		ctx.ui.setWorkingMessage(pickJoke());
		applyWorkingIndicator(ctx);
	});

	// Keep the location segment fresh as the working tree changes.
	pi.on("tool_execution_end", () => {
		scheduleGitRefresh();
	});
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => {
		if (ctx) applyWorkingIndicator(ctx);
	});
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		stopGitTimers();
		unsubscribeMode?.();
		unsubscribeMode = undefined;
		ctx = undefined;
		tui = undefined;
	});
}
