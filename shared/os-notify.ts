/**
 * os-notify — best-effort native OS notifications and the terminal bell.
 *
 * A timer fires in the terminal, but the whole point is that the operator has
 * looked away. The terminal bell plus the in-app notification only reach a
 * visible terminal, so each platform's own notifier is invoked too:
 *
 *   macOS    osascript `display notification` (always present)
 *   Linux    notify-send (libnotify; skipped when not installed)
 *   Windows  a PowerShell NotifyIcon balloon tip
 *
 * The call is fire-and-forget: the notifier is spawned detached with its stdio
 * ignored and unref'd, so it never blocks the timer callback or keeps the host
 * process alive, and a missing notifier (spawn `ENOENT`) is swallowed. Title and
 * message are passed as argv or environment variables — never interpolated into
 * a shell string — so a timer label cannot inject a command.
 *
 * Shared by the `timer` and `pomodoro` extensions.
 */

import { spawn } from "node:child_process";

export interface OsNotification {
	title: string;
	message: string;
}

/** PowerShell balloon-tip script; title and message arrive through the environment. */
const WINDOWS_SCRIPT = [
	"Add-Type -AssemblyName System.Windows.Forms",
	"Add-Type -AssemblyName System.Drawing",
	"$n = New-Object System.Windows.Forms.NotifyIcon",
	"$n.Icon = [System.Drawing.SystemIcons]::Information",
	"$n.Visible = $true",
	"$n.ShowBalloonTip(10000, $env:PI_NOTIFY_TITLE, $env:PI_NOTIFY_MESSAGE, [System.Windows.Forms.ToolTipIcon]::None)",
	"Start-Sleep -Milliseconds 6000",
	"$n.Dispose()",
].join("; ");

/** Spawn a notifier that outlives this call without holding the event loop. */
function fireAndForget(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
	try {
		const child = spawn(command, args, { stdio: "ignore", windowsHide: true, env });
		child.on("error", () => {});
		child.unref();
	} catch {
		// A failed spawn must never break the timer.
	}
}

/** Push a native notification for the current platform. Never throws, never blocks. */
export function notifyOperatingSystem({ title, message }: OsNotification): void {
	switch (process.platform) {
		case "darwin":
			// argv form avoids AppleScript string interpolation: the message is
			// data, not code. `--` ends osascript's options so a leading dash in
			// the message is not parsed as a flag.
			fireAndForget("osascript", [
				"-e",
				"on run argv",
				"-e",
				"display notification (item 1 of argv) with title (item 2 of argv)",
				"-e",
				"end run",
				"--",
				message,
				title,
			]);
			break;
		case "linux":
			fireAndForget("notify-send", ["--app-name=pi-adhd", "--", title, message]);
			break;
		case "win32":
			fireAndForget("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCRIPT], {
				...process.env,
				PI_NOTIFY_TITLE: title,
				PI_NOTIFY_MESSAGE: message,
			});
			break;
		default:
			break;
	}
}

/** Ring the terminal bell, but only when stdout is the interactive terminal. */
export function ringTerminalBell(): void {
	if (!process.stdout.isTTY) return;
	try {
		process.stdout.write("\x07");
	} catch {
		// A closed stream must not break the notification.
	}
}
