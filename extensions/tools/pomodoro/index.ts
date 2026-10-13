/**
 * pomodoro — the `/pomodoro` command: a work/break session built on the shared
 * timer registry.
 *
 * `/pomodoro` opens a config dialog (work, short break, long break, rounds) and
 * starts the first work phase. Each phase is a normal countdown in the shared
 * `timers` registry, so the footer shows the current phase exactly like a plain
 * `/timer`. When a work phase ends the next break is scheduled automatically,
 * and the session ends after the long break that follows the last round.
 *
 * The session is session-scoped: the pending phase timer is cancelled by the
 * idempotent `session_shutdown` handler. `/pomodoro stop` cancels early.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { POMODORO_BREAK, POMODORO_WORK } from "../../../shared/glyphs.ts";
import { notifyOperatingSystem, ringTerminalBell } from "../../../shared/os-notify.ts";
import { loadSettings, updateSettings, type PomodoroConfig } from "../../../shared/settings.ts";
import {
	formatDuration,
	nextTimerId,
	scheduleTimer,
	type PomodoroPhase,
	type TimerHandle,
} from "../../../shared/timers.ts";
import { showPomodoroConfig } from "./pane.ts";

interface Session {
	config: PomodoroConfig;
	/** Current work round, 1-based. */
	round: number;
	phase: PomodoroPhase;
	handle?: TimerHandle;
	ctx: ExtensionCommandContext;
}

function glyphFor(phase: PomodoroPhase): string {
	return phase === "work" ? POMODORO_WORK : POMODORO_BREAK;
}

function labelFor(phase: PomodoroPhase, round: number, config: PomodoroConfig): string {
	if (phase === "work") return `Work ${round}/${config.rounds}`;
	return phase === "break" ? "Break" : "Long break";
}

function durationMsFor(phase: PomodoroPhase, config: PomodoroConfig): number {
	const minutes =
		phase === "work" ? config.workMinutes : phase === "break" ? config.breakMinutes : config.longBreakMinutes;
	return minutes * 60_000;
}

/** Headless-safe output: notify in dialog-capable UIs, stderr text elsewhere. */
function emit(ctx: ExtensionCommandContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, severity);
		return;
	}
	console.error(text);
}

export default function pomodoroExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("pomodoro");
	let session: Session | undefined;

	/** Bell + in-app + OS announcement for a phase boundary. */
	const announce = (ctx: ExtensionCommandContext, message: string): void => {
		ringTerminalBell();
		emit(ctx, `${POMODORO_WORK} ${message}`);
		if (loadSettings().timer.osNotification) notifyOperatingSystem({ title: "Pi ADHD", message });
	};

	const startPhase = (): void => {
		if (!session) return;
		const { config, phase, round, ctx } = session;
		const durationMs = durationMsFor(phase, config);
		const name = labelFor(phase, round, config);
		session.handle = scheduleTimer(
			{ id: nextTimerId("pomodoro"), name, durationMs, kind: "pomodoro", phase },
			() => onPhaseEnd(),
		);
		emit(ctx, `${glyphFor(phase)} ${name} started (${formatDuration(durationMs)})`);
	};

	const onPhaseEnd = (): void => {
		if (!session) return;
		const { config, phase, round, ctx } = session;

		if (phase === "work") {
			const last = round >= config.rounds;
			session.phase = last ? "longBreak" : "break";
			announce(
				ctx,
				last
					? `Work ${round}/${config.rounds} finished — long break next.`
					: `Work ${round}/${config.rounds} finished — break time.`,
			);
			startPhase();
			return;
		}

		if (phase === "break") {
			session.round = round + 1;
			session.phase = "work";
			announce(ctx, "Break finished — back to work.");
			startPhase();
			return;
		}

		// Long break: the session is complete.
		announce(ctx, `Pomodoro complete — ${config.rounds} work sessions done.`);
		session = undefined;
	};

	const start = (ctx: ExtensionCommandContext, config: PomodoroConfig): void => {
		session = { config, round: 1, phase: "work", ctx };
		emit(
			ctx,
			`${POMODORO_WORK} Pomodoro: ${config.workMinutes}m work · ${config.breakMinutes}m break · ${config.longBreakMinutes}m long break · ${config.rounds} rounds`,
		);
		startPhase();
	};

	const stop = (ctx: ExtensionCommandContext): void => {
		if (!session) {
			emit(ctx, "No pomodoro running.");
			return;
		}
		session.handle?.cancel();
		session = undefined;
		emit(ctx, "Pomodoro stopped.");
	};

	pi.registerCommand("pomodoro", {
		description: "Start a pomodoro session, or stop the running one (usage: /pomodoro [stop])",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const sub = args.trim().toLowerCase();
			if (sub === "stop" || sub === "cancel") {
				stop(ctx);
				return;
			}
			if (session) {
				emit(ctx, "A pomodoro is already running. Use /pomodoro stop to cancel it.");
				return;
			}

			const defaults = loadSettings().pomodoro;
			// The config dialog needs the TUI; RPC and headless hosts start with the
			// saved configuration.
			const config = ctx.mode === "tui" ? await showPomodoroConfig(ctx.ui, defaults) : defaults;
			if (!config) {
				emit(ctx, "Pomodoro cancelled.");
				return;
			}
			updateSettings({ pomodoro: config });
			start(ctx, config);
		},
	});

	pi.on("session_shutdown", () => {
		session?.handle?.cancel();
		session = undefined;
	});
}
