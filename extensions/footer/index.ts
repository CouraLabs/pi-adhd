/**
 * footer — a richer, themed footer / status line for pi.
 *
 * Replaces the built-in footer with a compact, colorful status bar that shows
 * the current provider/model, thinking level, context-window gauge, git state,
 * working directory, turn/tool counters, and statuses published by other
 * extensions. Toggle it with `/couralabs-footer-ui [on|off]`.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { emptyGit, parseGitStatus, type GitInfo } from "./git.ts";
import { countHistory } from "./history.ts";
import { renderFooter } from "./render.ts";

const GIT_REFRESH_INTERVAL_MS = 10_000;
const GIT_DEBOUNCE_MS = 350;

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let tui: TUI | undefined;

	let enabled = true;
	let git: GitInfo = emptyGit();

	let turnCount = 0;
	let toolCount = 0;

	let gitTimer: ReturnType<typeof setTimeout> | undefined;
	let gitInterval: ReturnType<typeof setInterval> | undefined;

	const requestRender = () => tui?.requestRender();
	const isTui = () => ctx?.mode === "tui";

	const refreshGit = async () => {
		const c = ctx;
		if (!c) return;
		try {
			const result = await pi.exec("git", ["status", "--porcelain=v2", "--branch"], { cwd: c.cwd });
			git = result.code === 0 ? parseGitStatus(result.stdout) : emptyGit();
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

	const installFooter = (context: ExtensionContext) => {
		if (context.mode !== "tui") return;
		context.ui.setFooter((footerTui, theme, footerData) => {
			tui = footerTui;
			const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
			return {
				dispose: unsubscribe,
				invalidate() {},
				render: (width: number) =>
					renderFooter(
						{
							model: ctx?.model,
							thinkingLevel: pi.getThinkingLevel(),
							contextUsage: ctx?.getContextUsage(),
							git,
							gitBranch: footerData.getGitBranch(),
							cwd: ctx?.cwd,
							turns: turnCount,
							tools: toolCount,
							statuses: footerData.getExtensionStatuses(),
						},
						width,
						theme,
					),
			};
		});
		requestRender();
	};

	const uninstallFooter = (context: ExtensionContext) => {
		context.ui.setFooter(undefined);
		tui = undefined;
	};

	pi.registerCommand("couralabs-footer-ui", {
		description: "Toggle the pi-pack footer (usage: /couralabs-footer-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") enabled = true;
			else if (arg === "off") enabled = false;
			else enabled = !enabled;

			if (enabled) {
				installFooter(commandCtx);
				commandCtx.ui.notify("pi-pack footer enabled", "info");
			} else {
				uninstallFooter(commandCtx);
				commandCtx.ui.notify("Default footer restored", "info");
			}
		},
	});

	pi.on("session_start", (_event, context) => {
		ctx = context;
		const history = countHistory(context.sessionManager.getBranch());
		turnCount = history.turns;
		toolCount = history.tools;
		git = emptyGit();
		stopGitTimers();

		if (!enabled || context.mode !== "tui") return;

		installFooter(context);
		void refreshGit();
		gitInterval = setInterval(() => void refreshGit(), GIT_REFRESH_INTERVAL_MS);
	});

	pi.on("turn_start", () => {
		turnCount++;
		requestRender();
	});

	pi.on("tool_execution_end", () => {
		toolCount++;
		scheduleGitRefresh();
		requestRender();
	});

	// Keep the context gauge fresh as usage changes.
	pi.on("turn_end", () => requestRender());
	pi.on("agent_settled", () => requestRender());

	pi.on("model_select", () => {
		requestRender();
	});

	pi.on("thinking_level_select", () => {
		requestRender();
	});

	pi.on("session_info_changed", () => {
		requestRender();
	});

	pi.on("session_shutdown", () => {
		stopGitTimers();
		tui = undefined;
	});
}
