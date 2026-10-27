import type { SpawnStatus } from "../lifecycle/spawn-state.ts";
import { wrappedUpAtTurnLimit } from "../lifecycle/turn-limits.ts";
import type { AgentDetails, Theme } from "../ui/display.ts";
import { formatMs } from "../ui/display.ts";
import { GLYPHS, SPINNER } from "../ui/glyphs.ts";
import { emptyUsage, usageCost, usageGroup } from "../../../../shared/usage.ts";

export function renderAgentResult(
	details: AgentDetails,
	resultText: string,
	expanded: boolean,
	isPartial: boolean,
	theme: Theme,
): string {
	if (isPartial || details.status === "running") return renderRunning(details, theme);
	if (details.status === "completed")
		return renderCompleted(details, resultText, expanded, theme);
	if (details.status === "stopped") return renderStopped(details, theme);
	return renderFailed(details, theme);
}

export function renderRunning(details: AgentDetails, theme: Theme): string {
	const frame = SPINNER[details.spinnerFrame ?? 0];
	const s = renderStats(details, theme);
	let line = theme.fg("accent", frame) + (s ? " " + s : "");
	line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  ${details.activity ?? "thinking\u2026"}`);
	return line;
}

export function renderCompleted(
	details: AgentDetails,
	resultText: string,
	expanded: boolean,
	theme: Theme,
): string {
	const duration = formatMs(details.durationMs);
	const wrappedUp = wrappedUpAtTurnLimit(details);
	const icon = wrappedUp ? renderWrappedUpIcon(theme) : renderStatusIcon("completed", theme);
	const s = renderStats(details, theme);
	let line = icon + (s ? " " + s : "");
	line += " " + theme.fg("dim", "\u00B7") + " " + theme.fg("dim", duration);

	if (expanded) {
		if (resultText) {
			const lines = resultText.split("\n").slice(0, 50);
			for (const l of lines) {
				line += "\n" + theme.fg("dim", `  ${l}`);
			}
			if (resultText.split("\n").length > 50) {
				line +=
					"\n" +
					theme.fg(
						"muted",
						"  ... (output truncated)",
					);
			}
		}
	} else {
		const doneText = wrappedUp ? "Wrapped up (budget warning)" : "Done";
		line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  ${doneText}`);
	}
	return line;
}

export function renderStopped(details: AgentDetails, theme: Theme): string {
	const s = renderStats(details, theme);
	let line = renderStatusIcon("stopped", theme) + (s ? " " + s : "");
	line += "\n" + theme.fg("dim", `  ${GLYPHS.subLine}  Stopped`);
	return line;
}

export function renderFailed(details: AgentDetails, theme: Theme): string {
	const s = renderStats(details, theme);
	let line = renderStatusIcon(details.status === "error" ? "error" : "aborted", theme) + (s ? " " + s : "");

	if (details.status === "error") {
		line +=
			"\n" +
			theme.fg("error", `  ${GLYPHS.subLine}  Error: ${details.error ?? "unknown"}`);
	} else {
		line +=
			"\n" +
			theme.fg("warning", `  ${GLYPHS.subLine}  Aborted (turn limit reached)`);
	}
	return line;
}

function renderWrappedUpIcon(theme: Theme): string {
	return theme.fg("warning", GLYPHS.success);
}

export function renderStatusIcon(status: SpawnStatus, theme: Theme): string {
	switch (status) {
		case "completed":
			return theme.fg("success", GLYPHS.success);
		case "stopped":
			return theme.fg("dim", GLYPHS.stopped);
		case "error":
		case "aborted":
			return theme.fg("error", GLYPHS.failure);
		case "running":
			return theme.fg("dim", GLYPHS.streaming);
	}
}

export function renderStats(details: AgentDetails, theme: Theme): string {
	const parts: string[] = [];
	if (details.modelName) parts.push(theme.fg("dim", details.modelName));
	if (details.tags) parts.push(...details.tags.map((tag) => theme.fg("dim", tag)));
	const usage = details.usage ?? emptyUsage();
	const group = usageGroup(usage, theme);
	if (group) parts.push(group);
	const cost = usageCost(usage, theme);
	if (cost) parts.push(cost);
	return parts.join(" " + theme.fg("dim", "\u00B7") + " ");
}
