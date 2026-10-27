import type { AgentRunSnapshot } from "../render-agent.ts";

export const CONTINUE_PROMPT = "continue the implementation where it did stop";

const MAX_PROMPT_CHARACTERS = 2_000;

function describeAgent(agent: AgentRunSnapshot, index: number): string {
	const lines = [`${index + 1}. ${agent.subagentType ?? "agent"} — ${agent.description ?? "no description"} (${agent.status})`];
	if (agent.summary) lines.push(`   Last progress: ${agent.summary}`);
	if (agent.prompt) lines.push(`   Original prompt: ${agent.prompt.slice(0, MAX_PROMPT_CHARACTERS)}`);
	return lines.join("\n");
}

export function buildContinuationPrompt(interruptedAgents: readonly AgentRunSnapshot[], canRespawn: boolean): string {
	if (interruptedAgents.length === 0) return CONTINUE_PROMPT;
	const instruction = canRespawn
		? "These Claude subagents were interrupted by the rate limit. Re-run each unfinished one with the spawn tool (same agent type, original prompt, plus its last progress), then continue."
		: "These Claude subagents were interrupted by the rate limit. Re-run each unfinished one with the Agent tool, then continue.";
	return [CONTINUE_PROMPT, "", instruction, "", ...interruptedAgents.map(describeAgent)].join("\n");
}
