/**
 * editor — a closed, field-style prompt editor for pi.
 *
 * Wraps the built-in editor in a field-style box drawn with terminal box
 * characters, with a `⟫` marker on the first input line. The streaming working
 * indicator is embedded in the top border and the working directory + git
 * state in the bottom border; the box keeps a fixed border color rather than
 * tracking the thinking level. The "Working" label is replaced with a random
 * short joke phrase chosen fresh on every turn.
 *
 * Toggle it at any time with `/couralabs-prompt-ui [on|off]`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { loadSettings, updateSettings } from "../../shared/settings.ts";
import { FieldEditor, type LocationProvider } from "./field-editor.ts";
import { emptyGit, parseNumstat, type GitInfo } from "./git.ts";
import { JOKES } from "./jokes.ts";
import { SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./spinner.ts";

const GIT_REFRESH_INTERVAL_MS = 10_000;
const GIT_DEBOUNCE_MS = 350;

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;
	let currentEditor: FieldEditor | undefined;
	let enabled = true;
	let lastJoke = -1;
	let git: GitInfo = emptyGit();

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
		return { cwd: c.cwd, git, theme: c.ui.theme };
	};

	/** Install the dot spinner, colored to match the editor's thinking-level border. */
	const applyWorkingIndicator = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		const color = currentEditor?.borderColor ?? context.ui.theme.getThinkingBorderColor(pi.getThinkingLevel());
		context.ui.setWorkingIndicator({
			frames: SPINNER_FRAMES.map((frame) => color(frame)),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	};

	const pickJoke = (): string => {
		if (JOKES.length === 0) return "Working";
		let index = Math.floor(Math.random() * JOKES.length);
		if (JOKES.length > 1 && index === lastJoke) index = (index + 1) % JOKES.length;
		lastJoke = index;
		return JOKES[index] ?? "Working";
	};

	const installEditor = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setEditorComponent((editorTui, theme, keybindings) => {
			tui = editorTui;
			currentEditor = new FieldEditor(editorTui, theme, keybindings, locationProvider);
			return currentEditor;
		});
		applyWorkingIndicator(context);
	};

	const uninstallEditor = (context: ExtensionContext) => {
		context.ui.setEditorComponent(undefined);
		context.ui.setWorkingIndicator();
		currentEditor = undefined;
		tui = undefined;
	};

	pi.registerCommand("couralabs-prompt-ui", {
		description: "Toggle the pi-pack prompt field (usage: /couralabs-prompt-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			updateSettings({ editor: { enabled } });

			if (enabled) {
				installEditor(commandCtx);
				commandCtx.ui.notify("pi-pack prompt field enabled", "info");
			} else {
				uninstallEditor(commandCtx);
				commandCtx.ui.notify("Default editor restored", "info");
			}
		},
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		enabled = loadSettings().editor.enabled;
		git = emptyGit();
		stopGitTimers();
		if (!enabled || context.mode !== "tui") return;
		installEditor(context);
		void refreshGit();
		gitInterval = setInterval(() => void refreshGit(), GIT_REFRESH_INTERVAL_MS);
	});

	// Swap in a new joke phrase for every turn and refresh the spinner colors.
	pi.on("turn_start", () => {
		if (!enabled || !ctx || ctx.mode !== "tui") return;
		ctx.ui.setWorkingMessage(pickJoke());
		applyWorkingIndicator(ctx);
	});

	// Keep the location segment fresh as the working tree changes.
	pi.on("tool_execution_end", () => {
		if (enabled) scheduleGitRefresh();
	});
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());
	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => {
		if (enabled && ctx) applyWorkingIndicator(ctx);
	});
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_shutdown", () => {
		stopGitTimers();
		ctx = undefined;
		tui = undefined;
		currentEditor = undefined;
	});
}
