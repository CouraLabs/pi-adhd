/**
 * editor — a closed, field-style prompt editor for pi.
 *
 * Wraps the built-in editor in a field-style box drawn with terminal box
 * characters, with a `❯` marker on the first input line. The working
 * directory + git state live in the bottom border; the box border follows the
 * active agent mode rather than the thinking level. While the agent runs, a
 * loading widget floats above the box (pi's `aboveEditor` widget slot, in
 * place of the built-in working row) and names the current phase — Prompting,
 * Thinking, Answering, or the executing tool's verb ("Reading", "Writing", …)
 * — followed by a running clock, the live output-token estimate (streamed
 * characters ÷ 4, see `./status.ts`), the live tokens/sec rate, and the
 * interrupt hint: `🞘 Reading for 12s ∙ ↓ 3400 ∙ ⭍ 214.2 tok/s (esc)`. When the run
 * settles the widget keeps the last turn's clock and output tokens on screen
 * while the next prompt is typed: `✓ Finished in 45s ∙ ↓ 12300 ∙ ⭍ 275.4 tok/s`.
 *
 * Toggle it with `/couralabs:toggle editor`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadSettings, updateSettings } from "../../../shared/settings.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { subscribeAgentMode } from "../../../shared/modes.ts";
import { FieldEditor, type LocationProvider } from "./field-editor.ts";
import { emptyGit, parseNumstat, type GitInfo } from "./git.ts";
import { SPINNER_INTERVAL_MS } from "./spinner.ts";
import { LoadingWidget, type LoadingFigures } from "./loading.ts";
import { WorkingStatusTracker } from "./status.ts";

const GIT_REFRESH_INTERVAL_MS = 10_000;
const GIT_DEBOUNCE_MS = 350;

/** Widget slot key for the loading widget above the editor. */
const LOADING_WIDGET_KEY = "couralabs:editor/loading";

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("editor");
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let fullCwd = false;
	let git: GitInfo = emptyGit();
	let unsubscribeMode: (() => void) | undefined;
	/** The live run's tracker; undefined while the agent is idle. */
	let tracker: WorkingStatusTracker | undefined;
	/** The last settled run's figures; stays on the widget until the next run. */
	let settled: LoadingFigures | undefined;
	/** Spinner/refresh tick while a run is live; the widget animates on it. */
	let widgetTick: ReturnType<typeof setInterval> | undefined;

	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let gitInterval: ReturnType<typeof setInterval> | undefined;

	const requestRender = () => tui?.requestRender();
	const isTui = () => ctx?.mode === "tui";

	/** Where the widget reads its numbers each frame: the live tracker, then
	 *  the settled summary. Kept as functions so every render sees the
	 *  current state without re-mounting the widget. */
	const loadingSources = () => ({
		running: () => (tracker ? tracker.parts() : undefined),
		settled: () => settled,
		// Read live: `session_info_changed` (a new session name, including one the
		// session-title extension just generated) triggers the render that picks it up.
		sessionName: () => ctx?.sessionManager.getSessionName(),
	});

	const startWidgetTick = (): void => {
		stopWidgetTick();
		widgetTick = setInterval(requestRender, SPINNER_INTERVAL_MS);
	};

	const stopWidgetTick = (): void => {
		if (widgetTick) {
			clearInterval(widgetTick);
			widgetTick = undefined;
		}
	};

	/** Hide pi's built-in working row and mount the loading widget above the editor. */
	const installLoadingWidget = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setWorkingVisible(false);
		context.ui.setWidget(
			LOADING_WIDGET_KEY,
			(widgetTui, theme) => {
				tui = widgetTui;
				return new LoadingWidget(theme, loadingSources());
			},
			{ placement: "aboveEditor" },
		);
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

	const installEditor = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setEditorComponent((editorTui, theme, keybindings) => {
			tui = editorTui;
			return new FieldEditor(editorTui, theme, keybindings, locationProvider, () =>
				tracker !== undefined ? "running" : "idle",
			);
		});
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
		settled = undefined;
		stopWidgetTick();

		// Re-render when /mode switches the agent mode (the editor border and
		// the loading spinner both read it live off the frame).
		unsubscribeMode?.();
		unsubscribeMode = subscribeAgentMode(() => requestRender());

		if (context.mode !== "tui") return;
		installEditor(context);
		installLoadingWidget(context);
		void refreshGit();
		gitInterval = setInterval(() => void refreshGit(), GIT_REFRESH_INTERVAL_MS);
	});

	// A run began: spin up a fresh tracker and the widget's animation tick.
	pi.on("agent_start", (event) => {
		if (!ctx || ctx.mode !== "tui") return;
		tracker = new WorkingStatusTracker(loadSettings().editor.toolVerbs);
		tracker.onAgentStart(event);
		settled = undefined;
		startWidgetTick();
		requestRender();
	});

	// An assistant return opened: its request is on the wire; the rate's
	// streaming span starts at the return's first token.
	pi.on("message_start", (event) => {
		tracker?.onMessageStart(event);
		requestRender();
	});

	// Streaming deltas move the phase and grow the token estimate.
	pi.on("message_update", (event) => {
		tracker?.onMessageUpdate(event);
		requestRender();
	});

	// The return closed: its streaming span is banked into the rate.
	pi.on("message_end", (event) => {
		tracker?.onMessageEnd(event);
		requestRender();
	});

	// Tool executions rename the line to the tool's verb.
	pi.on("tool_execution_start", (event) => {
		tracker?.onToolExecutionStart(event);
		requestRender();
	});
	pi.on("tool_execution_end", (event) => {
		tracker?.onToolExecutionEnd(event);
		requestRender();
		scheduleGitRefresh();
	});

	// The run settled: freeze the tracker's final figures into the widget's
	// settled summary — they stay on screen until the next run replaces them.
	pi.on("agent_end", (event) => {
		if (!tracker) return;
		settled = tracker.parts();
		tracker.onAgentEnd(event);
		tracker = undefined;
		stopWidgetTick();
		requestRender();
	});

	pi.on("agent_settled", () => {
		stopWidgetTick();
		tracker = undefined;
		requestRender();
	});
	pi.on("turn_end", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => requestRender());
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		stopGitTimers();
		stopWidgetTick();
		unsubscribeMode?.();
		unsubscribeMode = undefined;
		if (ctx?.mode === "tui") ctx.ui.setWidget(LOADING_WIDGET_KEY, undefined);
		tracker = undefined;
		settled = undefined;
		ctx = undefined;
		tui = undefined;
	});
}
