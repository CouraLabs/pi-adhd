import type { ResumeRefusal } from "../lifecycle/spawn.ts";
import type { SpawnStatus } from "../lifecycle/spawn-state.ts";
import { type TurnBudget, wrappedUpAtTurnLimit } from "../lifecycle/turn-limits.ts";

interface StatusMeaning {

	label: string;

	detail: string;
}

const STATUS_MEANINGS: Partial<Record<SpawnStatus, StatusMeaning>> = {
	aborted: { label: "Aborted", detail: "turn limit reached, output may be incomplete" },

	stopped: { label: "Stopped", detail: "user request" },
};

const WRAPPED_UP: StatusMeaning = { label: "Wrapped up", detail: "after turn-budget warning" };

export interface StatusOutcome {
	status: SpawnStatus;
	error?: string;
	turnBudget?: TurnBudget;
}

function statusMeaning(outcome: StatusOutcome): StatusMeaning | undefined {
	return wrappedUpAtTurnLimit(outcome) ? WRAPPED_UP : STATUS_MEANINGS[outcome.status];
}

const RESUME_REFUSAL_CLAUSES: Record<Exclude<ResumeRefusal, "still-running">, string> = {

	"no-session": "it has no active session",
	"session-released": "its session was released after its retention window",
	"workspace-disposed": "it ran in an isolated workspace that has since been removed",
};

export function renderStatusNote(outcome: StatusOutcome): string {
	const meaning = statusMeaning(outcome);
	if (!meaning) return "";
	return ` (${meaning.label.toLowerCase()} \u2014 ${meaning.detail})`;
}

export interface OutcomeBody {
	status: SpawnStatus;
	result: string | undefined;
	error: string | undefined;
}

export function renderQuestionAffordance(
	agentId: string,
	question: string | undefined,
	refusal: ResumeRefusal | undefined,
): string {
	if (!question) return "";
	const quoted = question
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
	if (refusal === "still-running") {
		return (
			"\n\nThis agent asked a question before it finished running, so it cannot be " +
			`resumed yet:\n\n${quoted}\n\n` +
			"Wait for it to settle, then answer it."
		);
	}
	if (refusal) {
		return (
			"\n\nThis agent ended its run with a question that can no longer be answered \u2014 " +
			`${RESUME_REFUSAL_CLAUSES[refusal]}:\n\n${quoted}\n\n` +
			"Spawn a new agent with the context it needs; this one cannot be resumed."
		);
	}
	return (
		`\n\nThis agent is waiting on an answer:\n\n${quoted}\n\n` +
		`Answer by calling spawn with resume: "${agentId}" and your answer as the prompt.`
	);
}

export function renderWorkspaceNotice(notice: string | undefined): string {
	return notice ?? "";
}

export interface OutcomeAddenda {
	id: string;
	workspaceNotice?: string;
	pendingQuestion?: string;

	resumeRefusal: ResumeRefusal | undefined;
}

export function renderOutcomeAddenda(outcome: OutcomeAddenda): string {
	return (

		renderWorkspaceNotice(outcome.workspaceNotice) +
		renderQuestionAffordance(outcome.id, outcome.pendingQuestion, outcome.resumeRefusal)
	);
}

export function renderOutcomeBody(outcome: OutcomeBody): string {
	if (outcome.status === "error") return `Error: ${outcome.error}`;
	const trimmed = outcome.result?.trim();

	return trimmed || "No output.";
}
