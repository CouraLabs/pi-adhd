import type { AgentConfig, ThinkingLevel } from "../types.ts";

export interface InvocationOverrideParams {
	model?: string;
	thinking?: ThinkingLevel;
	max_turns?: number;
	inherit_context?: boolean;
}

export interface ResolvedInvocationOverrides {
	modelInput?: string;
	modelFromParams: boolean;
	thinking?: ThinkingLevel;
	maxTurns?: number;
	inheritContext: boolean;
}

export function resolveInvocationOverrides(
	agentConfig: AgentConfig,
	params: InvocationOverrideParams,
): ResolvedInvocationOverrides {
	return {
		modelInput: params.model ?? agentConfig.model,
		modelFromParams: params.model !== undefined,
		thinking: params.thinking ?? agentConfig.thinking,
		maxTurns: params.max_turns ?? agentConfig.maxTurns,
		inheritContext: params.inherit_context ?? agentConfig.inheritContext ?? false,
	};
}
