import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { loadAgentDefinitions } from "../../tools/spawn/config/custom-agents.ts";
import { BUILTIN_TOOL_NAMES } from "../../tools/spawn/config/agent-types.ts";
import { type DefaultModelRef } from "../../tools/spawn/session/model-resolver.ts";
import type { AgentConfig } from "../../tools/spawn/types.ts";
import { familyToSdkModelId } from "./models.ts";
import { toSdkToolName } from "./policy.ts";

function toSdkTools(piToolNames: readonly string[]): string[] {
	return [...new Set(piToolNames.map(toSdkToolName))];
}

function toSdkModelInput(config: AgentConfig, defaultModelRef: DefaultModelRef | undefined): string {
	if (config.model === "default" && defaultModelRef) {
		return familyToSdkModelId(`${defaultModelRef.provider}/${defaultModelRef.id}`);
	}
	return familyToSdkModelId(config.model);
}

function toAgentDefinition(config: AgentConfig, defaultModelRef: DefaultModelRef | undefined): AgentDefinition {
	const definition: AgentDefinition = {
		description: config.description,
		prompt: config.systemPrompt,
		model: toSdkModelInput(config, defaultModelRef),
	};
	if (config.allTools !== true) {
		definition.tools = toSdkTools(config.toolNames ?? BUILTIN_TOOL_NAMES);
	}
	if (config.maxTurns !== undefined && config.maxTurns > 0) definition.maxTurns = config.maxTurns;
	return definition;
}

export function fromPiAgentDefinitions(
	cwd: string,
	defaultModelRef: DefaultModelRef | undefined,
): Record<string, AgentDefinition> {
	const definitions: Record<string, AgentDefinition> = {};
	for (const [name, config] of loadAgentDefinitions(cwd)) {
		if (config.enabled === false) continue;
		definitions[name] = toAgentDefinition(config, defaultModelRef);
	}
	return definitions;
}
