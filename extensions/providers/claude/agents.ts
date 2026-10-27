import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { loadCustomAgents } from "../../tools/spawn/config/custom-agents.ts";
import type { AgentConfig } from "../../tools/spawn/types.ts";
import { familyToSdkModelId } from "./models.ts";
import { toSdkToolName } from "./policy.ts";

function toSdkTools(piToolNames: readonly string[] | undefined): string[] | undefined {
	if (piToolNames === undefined) return undefined;
	return [...new Set(piToolNames.map(toSdkToolName))];
}

function toAgentDefinition(config: AgentConfig): AgentDefinition {
	const definition: AgentDefinition = {
		description: config.description,
		prompt: config.systemPrompt,
		model: familyToSdkModelId(config.model),
	};
	const tools = toSdkTools(config.toolNames);
	if (tools !== undefined) definition.tools = tools;
	if (config.maxTurns !== undefined && config.maxTurns > 0) definition.maxTurns = config.maxTurns;
	return definition;
}

export function fromPiAgentDefinitions(cwd: string): Record<string, AgentDefinition> {
	const definitions: Record<string, AgentDefinition> = {};
	for (const [name, config] of loadCustomAgents(cwd)) {
		if (config.enabled === false) continue;
		definitions[name] = toAgentDefinition(config);
	}
	return definitions;
}
