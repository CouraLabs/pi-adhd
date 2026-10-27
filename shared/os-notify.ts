import { spawn } from "node:child_process";

export interface OsNotification {
	title: string;
	message: string;
}

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

function fireAndForget(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
	try {
		const child = spawn(command, args, { stdio: "ignore", windowsHide: true, env });
		child.on("error", () => {});
		child.unref();
	} catch {

	}
}

export function notifyOperatingSystem({ title, message }: OsNotification): void {
	switch (process.platform) {
		case "darwin":

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

export function ringTerminalBell(): void {
	if (!process.stdout.isTTY) return;
	try {
		process.stdout.write("\x07");
	} catch {

	}
}
