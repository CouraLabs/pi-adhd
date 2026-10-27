import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EntryRenderer } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export const BACKGROUND_REPORT_ENTRY_TYPE = "claude-background-report";

export type BackgroundTaskStatus = "completed" | "failed" | "stopped";

export interface BackgroundTaskNotice {
	taskId: string;
	status: BackgroundTaskStatus;
	summary: string;
}

export interface BackgroundReportData {
	notices: BackgroundTaskNotice[];
	report: string;
}

type ReportListener = (sessionKey: string, data: BackgroundReportData) => void;

const listeners = new Set<ReportListener>();

export function observeBackgroundReports(listener: ReportListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function emitReport(sessionKey: string, data: BackgroundReportData): void {
	for (const listener of [...listeners]) listener(sessionKey, data);
}

export class WakeTurnCollector {
	private readonly sessionKey: string;
	private open = false;
	private readonly textParts: string[] = [];
	private readonly notices: BackgroundTaskNotice[] = [];

	constructor(sessionKey: string) {
		this.sessionKey = sessionKey;
	}

	get collecting(): boolean {
		return this.open;
	}

	feed(message: SDKMessage): void {
		if (message.type === "system") {
			if (message.subtype === "init") {
				if (this.open) this.flush();
				this.open = true;
				return;
			}
			if (message.subtype === "task_notification") {
				this.notices.push({ taskId: message.task_id, status: message.status, summary: message.summary });
			}
			return;
		}
		if (message.type === "assistant") {
			if (message.parent_tool_use_id !== null) return;
			this.collectText(message);
			return;
		}
		if (message.type === "result" && (this.open || this.notices.length > 0 || this.textParts.length > 0)) this.flush();
	}

	private collectText(message: Extract<SDKMessage, { type: "assistant" }>): void {
		const content = message.message.content;
		if (!Array.isArray(content)) return;
		const text = content
			.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
			.filter((text) => text.trim().length > 0)
			.join("\n");
		if (text.length > 0) this.textParts.push(text);
	}

	private flush(): void {
		this.open = false;
		const notices = [...this.notices];
		const report = this.textParts.join("\n\n").trim();
		this.notices.length = 0;
		this.textParts.length = 0;
		if (notices.length === 0 && report.length === 0) return;
		emitReport(this.sessionKey, { notices, report });
	}
}

function isBackgroundReportData(value: unknown): value is BackgroundReportData {
	if (typeof value !== "object" || value === null) return false;
	const data = value as { notices?: unknown; report?: unknown };
	if (!Array.isArray(data.notices) || typeof data.report !== "string") return false;
	return data.notices.every(
		(notice) =>
			typeof notice === "object" &&
			notice !== null &&
			typeof (notice as BackgroundTaskNotice).taskId === "string" &&
			typeof (notice as BackgroundTaskNotice).status === "string" &&
			typeof (notice as BackgroundTaskNotice).summary === "string",
	);
}

const STATUS_COLORS: Record<BackgroundTaskStatus, "success" | "error" | "warning"> = {
	completed: "success",
	failed: "error",
	stopped: "warning",
};

export const backgroundReportRenderer: EntryRenderer<BackgroundReportData> = (entry, _options, theme) => {
	if (!isBackgroundReportData(entry.data)) return undefined;
	const lines: string[] = [];
	if (entry.data.notices.length === 0) lines.push(theme.fg("accent", `⯁ Background update`));
	for (const notice of entry.data.notices) {
		lines.push(theme.fg(STATUS_COLORS[notice.status] ?? "accent", `⯁ ${notice.summary}`));
	}
	for (const line of entry.data.report.split("\n")) lines.push(theme.fg("muted", `  ${line}`));
	return new Text(lines.join("\n"), 0, 0);
};
