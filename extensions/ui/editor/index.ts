/**
 * editor — a closed, field-style prompt editor for pi.
 *
 * Wraps the built-in editor in a field-style box drawn with terminal box
 * characters, with a `❯` marker on the first input line. The working
 * directory + git state live in the bottom border; the box border follows the
 * active agent mode rather than the thinking level. While the agent runs, a
 * working-status line floats above the box (pi's `statusContainer`) and names
 * the current phase — Prompting, Thinking, Answering, or the executing
 * tool's verb ("Reading", "Writing", …) — followed by a running clock, the
 * live received-token count, and the interrupt hint:
 * `🞘 Reading 12s, ↓3.4k (esc)`.
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
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";
import { WorkingStatusTracker } from "./status.ts";

const GIT_REFRESH_INTERVAL_MS = 10_000;
const GIT_DEBOUNCE_MS = 350;

/** Clock tick for the working-status line's run-time figure. */
const STATUS_TICK_MS = 1000;

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("editor");
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let fullCwd = false;
	let git: GitInfo = emptyGit();
	let unsubscribeMode: (() => void) | undefined;
	/** The live run's tracker; undefined while the agent is idle. */
	let tracker: WorkingStatusTracker | undefined;
	/** Last status text pushed to the working indicator; dedupes setWorkingMessage calls. */
	let lastStatusText = "";
	let statusTick: ReturnType<typeof setInterval> | undefined;

	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let gitInterval: ReturnType<typeof setInterval> | undefined;

	const requestRender = () => tui?.requestRender();
	const isTui = () => ctx?.mode === "tui";

	/** Push the current status text when it changed; safe while detached.
	 *  The received-token span rides the info color (accent), the rest muted. */
	const pushStatus = (): void => {
		if (!ctx || !tracker || ctx.mode !== "tui") return;
		const parts = tracker.parts();
		const theme = ctx.ui.theme;
		const text =
			theme.fg("muted", `${parts.label} ${parts.elapsed}, `) +
			theme.fg("accent", `↓${parts.tokens}`) +
			theme.fg("muted", " (esc)");
		if (text === lastStatusText) return;
		lastStatusText = text;
		ctx.ui.setWorkingMessage(text);
	};

	const startStatusClock = (): void => {
		stopStatusClock();
		statusTick = setInterval(pushStatus, STATUS_TICK_MS);
	};

	const stopStatusClock = (): void => {
		if (statusTick) {
			clearInterval(statusTick);
			statusTick = undefined;
		}
	};

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
		tracker = undefined;
		lastStatusText = "";
		stopStatusClock();

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

	// A run began: spin up a fresh tracker and the status clock.
	pi.on("agent_start", (event, context) => {
		if (!ctx || ctx.mode !== "tui") return;
		tracker = new WorkingStatusTracker(loadSettings().editor.toolVerbs);
		tracker.onAgentStart(event);
		pushStatus();
		startStatusClock();
		applyWorkingIndicator(context);
	});

	// Streaming deltas move the phase and grow the received-token figure.
	pi.on("message_update", (event) => {
		tracker?.onMessageUpdate(event);
		pushStatus();
	});

	// Tool executions rename the line to the tool's verb.
	pi.on("tool_execution_start", (event) => {
		tracker?.onToolExecutionStart(event);
		pushStatus();
	});
	pi.on("tool_execution_end", (event) => {
		tracker?.onToolExecutionEnd(event);
		pushStatus();
		scheduleGitRefresh();
	});

	// The run settled: drop the tracker and the clock until the next run.
	pi.on("agent_end", (event) => {
		tracker?.onAgentEnd(event);
		pushStatus();
		stopStatusClock();
		tracker = undefined;
	});

	pi.on("agent_settled", () => {
		stopStatusClock();
		tracker = undefined;
		requestRender();
	});
	pi.on("turn_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => {
		if (ctx) applyWorkingIndicator(ctx);
	});
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		stopGitTimers();
		stopStatusClock();
		unsubscribeMode?.();
		unsubscribeMode = undefined;
		tracker = undefined;
		ctx = undefined;
		tui = undefined;
	});
}
