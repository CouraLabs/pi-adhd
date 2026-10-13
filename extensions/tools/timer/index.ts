/**
 * timer — the `/timer` command: one or more named countdowns.
 *
 * Every timer is scheduled through the shared `timers` registry, so several can
 * run at once and the footer shows the one that expires first. A timer fires
 * the terminal bell, an in-app notification, and (unless disabled) a native OS
 * notification titled `Pi ADHD`.
 *
 * Timers are session-scoped: they are created by the command (never in the
 * factory, per the extension lifecycle contract) and cancelled by the
 * idempotent `session_shutdown` handler, so a reload or session replacement
 * never leaves a timer behind that would fire into a dead context.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { notifyOperatingSystem, ringTerminalBell } from "../../../shared/os-notify.ts";
import { loadSettings } from "../../../shared/settings.ts";
import { TIMER_GLYPH } from "../../../shared/glyphs.ts";
import {
	formatCountdown,
	formatDuration,
	getTimers,
	nextTimerId,
	remainingMs,
	scheduleTimer,
	type TimerHandle,
} from "../../../shared/timers.ts";
import { parseDuration } from "./parse.ts";

const USAGE = [
	"Usage: /timer <duration> [name]",
	"  <duration>  e.g. 90s, 5m, 1h, 1h30m, 25m30s",
	"  [name]      optional label, quoted or not: /timer 10s \"Take a break\"",
	"  /timer list           List running timers",
	"  /timer stop <name|id> Cancel one timer",
	"  /timer clear          Cancel every timer",
].join("\n");

/** Strip one pair of matching surrounding quotes from a label. */
function unquote(text: string): string {
	const trimmed = text.trim();
	const quoted =
		trimmed.length >= 2 &&
		((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")));
	return quoted ? trimmed.slice(1, -1).trim() : trimmed;
}

/** Headless-safe output: notify in dialog-capable UIs, stderr text elsewhere. */
function emit(ctx: ExtensionCommandContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, severity);
		return;
	}
	console.error(text);
}

export default function timerExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("timer");
	const handles = new Map<string, TimerHandle>();

	/** Schedule a countdown and wire its completion announcement. */
	const start = (ctx: ExtensionCommandContext, durationMs: number, name: string): void => {
		const label = name || formatDuration(durationMs);
		const handle = scheduleTimer(
			{ id: nextTimerId("timer"), name: label, durationMs, kind: "timer" },
			(timer) => {
				handles.delete(timer.id);
				const message = `Timer ${timer.name} finished.`;
				ringTerminalBell();
				emit(ctx, `${TIMER_GLYPH} ${message}`);
				if (loadSettings().timer.osNotification) notifyOperatingSystem({ title: "Pi ADHD", message });
			},
		);
		handles.set(handle.id, handle);
		const active = getTimers().filter((timer) => timer.kind === "timer").length;
		const plural = active === 1 ? "timer" : "timers";
		emit(ctx, `${TIMER_GLYPH} Timer set for ${formatDuration(durationMs)}: ${label} (${active} ${plural} active)`);
	};

	const list = (ctx: ExtensionCommandContext): void => {
		const timers = getTimers()
			.filter((timer) => timer.kind === "timer")
			.sort((a, b) => a.endsAt - b.endsAt);
		if (timers.length === 0) {
			emit(ctx, "No active timers.");
			return;
		}
		const now = Date.now();
		emit(
			ctx,
			timers
				.map((timer) => `${TIMER_GLYPH} ${formatCountdown(remainingMs(timer, now))} — ${timer.name} (${timer.id})`)
				.join("\n"),
		);
	};

	const stop = (ctx: ExtensionCommandContext, query: string): void => {
		if (!query) {
			emit(ctx, "Usage: /timer stop <name|id>", "error");
			return;
		}
		const needle = query.toLowerCase();
		const matches = getTimers().filter(
			(timer) => timer.kind === "timer" && (timer.id === query || timer.name.toLowerCase() === needle),
		);
		if (matches.length === 0) {
			emit(ctx, `No timer named "${query}".`, "error");
			return;
		}
		if (matches.length > 1) {
			emit(ctx, `"${query}" matches ${matches.length} timers; use the id.`, "warning");
			return;
		}
		handles.get(matches[0].id)?.cancel();
		handles.delete(matches[0].id);
		emit(ctx, `Cancelled timer ${matches[0].name}.`);
	};

	const clear = (ctx: ExtensionCommandContext): void => {
		const count = handles.size;
		for (const handle of handles.values()) handle.cancel();
		handles.clear();
		emit(ctx, count === 0 ? "No active timers." : `Cancelled ${count} timer${count === 1 ? "" : "s"}.`);
	};

	pi.registerCommand("timer", {
		description: "Start one or more countdown timers (usage: /timer <duration> [name])",
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const trimmed = args.trim();
			if (!trimmed) {
				if (getTimers().some((timer) => timer.kind === "timer")) list(ctx);
				else emit(ctx, USAGE);
				return;
			}

			const space = trimmed.search(/\s/);
			const verb = space === -1 ? trimmed : trimmed.slice(0, space);
			const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();

			switch (verb.toLowerCase()) {
				case "list":
				case "ls":
					list(ctx);
					return;
				case "stop":
				case "cancel":
					stop(ctx, unquote(rest));
					return;
				case "clear":
					clear(ctx);
					return;
				case "help":
				case "?":
					emit(ctx, USAGE);
					return;
			}

			const ms = parseDuration(verb);
			if (ms === undefined) {
				emit(ctx, `Invalid duration "${verb}".\n${USAGE}`, "error");
				return;
			}
			start(ctx, ms, unquote(rest));
		},
	});

	pi.on("session_shutdown", () => {
		for (const handle of handles.values()) handle.cancel();
		handles.clear();
	});
}
