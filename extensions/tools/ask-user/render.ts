import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { replaceTabs } from "./compat.ts";
import type { AskToolDetails } from "./types.ts";

function flattenToOneLine(text: string): string {
	return replaceTabs(text).replace(/\s+/g, " ").trim();
}

function answerLine(
	theme: Theme,
	label: string,
	selectedOptions: string[] | undefined,
	customInput: string | undefined,
	timedOut: boolean | undefined,
): string {
	const parts: string[] = [];
	if (selectedOptions && selectedOptions.length > 0) parts.push(selectedOptions.join(", "));
	if (customInput !== undefined) parts.push(`“${flattenToOneLine(customInput)}”`);
	const answer = parts.length > 0 ? theme.fg("toolOutput", parts.join(" · ")) : theme.fg("warning", "(no answer)");
	const timeoutMark = timedOut ? theme.fg("dim", " · auto-selected after timeout") : "";
	return `${theme.fg("muted", label)}${theme.fg("dim", " → ")}${answer}${timeoutMark}`;
}

function firstTextOf(result: AgentToolResult<unknown>): string {
	const block = result.content[0];
	return block?.type === "text" && block.text ? block.text : "";
}

export function renderAskCall(args: { questions?: unknown }, theme: Theme): Text {
	const count = Array.isArray(args.questions) ? args.questions.length : 0;
	const summary = count > 0 ? `Ask · ${count} ${count === 1 ? "question" : "questions"}` : "Ask";
	return new Text(theme.fg("dim", summary), 0, 0);
}

export function renderAskResult(result: AgentToolResult<unknown>, theme: Theme): Text {
	const details = result.details as AskToolDetails | undefined;

	if (!details) {
		const fallback = firstTextOf(result);
		return new Text(`${theme.fg("warning", "~ Ask")}${fallback ? `\n${theme.fg("dim", fallback)}` : ""}`, 0, 0);
	}

	if (details.results && details.results.length > 0) {
		const lines = details.results.map((entry) =>
			answerLine(theme, `[${entry.id}] ${flattenToOneLine(entry.question)}`, entry.selectedOptions, entry.customInput, entry.timedOut),
		);
		return new Text(lines.join("\n"), 0, 0);
	}

	if (!details.question) return new Text(firstTextOf(result), 0, 0);

	return new Text(
		answerLine(theme, flattenToOneLine(details.question), details.selectedOptions, details.customInput, details.timedOut),
		0,
		0,
	);
}
