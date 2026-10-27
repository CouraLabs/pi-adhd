import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import {
	SUBMODE_TOOLS,
	getSubmode,
	getSubmodePromptSections,
	type ToolNameMap,
} from "../../../shared/submodes.ts";

export const PI_TO_SDK_TOOL_NAMES: ToolNameMap = new Map([
	["read", "Read"],
	["write", "Write"],
	["edit", "Edit"],
	["bash", "Bash"],
	["grep", "Grep"],
	["find", "Glob"],
	["ls", "Glob"],
	["webfetch", "WebFetch"],
	["websearch", "WebSearch"],
	["job", "Bash"],
	["job-kill", "TaskStop"],
	["spawn", "Agent"],
	["ask", "AskUserQuestion"],
	["plan-write", "mcp__pi__plan-write"],
	["submode-exit", "mcp__pi__submode-exit"],
]);

const ALWAYS_ALLOWED_SDK_TOOLS: ReadonlySet<string> = new Set(["Skill"]);

export function toSdkToolName(piToolName: string): string {
	return PI_TO_SDK_TOOL_NAMES.get(piToolName) ?? piToolName;
}

export function allowedSdkToolsForActiveSubmode(): ReadonlySet<string> | undefined {
	const submode = getSubmode();
	if (submode === "none") return undefined;
	const allowed = new Set(ALWAYS_ALLOWED_SDK_TOOLS);
	for (const piToolName of SUBMODE_TOOLS[submode]) {
		const sdkToolName = PI_TO_SDK_TOOL_NAMES.get(piToolName);
		if (sdkToolName !== undefined) allowed.add(sdkToolName);
	}
	return allowed;
}

export function buildSubmodeAppend(): string | undefined {
	const sections = Object.entries(getSubmodePromptSections(PI_TO_SDK_TOOL_NAMES));
	if (sections.length === 0) return undefined;
	return sections.map(([tag, content]) => `<${tag}>\n${content}\n</${tag}>`).join("\n\n");
}

export const submodePolicyHook: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse") return {};
	const allowed = allowedSdkToolsForActiveSubmode();
	if (allowed === undefined || allowed.has(input.tool_name)) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: `${input.tool_name} is not available in the ${getSubmode()} submode. Allowed tools: ${[...allowed].sort().join(", ")}.`,
		},
	};
};

export const foregroundAgentHook: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Agent") return {};
	const toolInput = input.tool_input as Record<string, unknown>;
	if (toolInput.run_in_background !== true) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "allow",
			updatedInput: { ...toolInput, run_in_background: false },
		},
	};
};
