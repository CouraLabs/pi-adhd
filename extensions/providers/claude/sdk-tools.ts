export const SDK_TOOL_NAMES = [
	"Bash",
	"Read",
	"Grep",
	"Glob",
	"WebSearch",
	"WebFetch",
	"TaskStop",
	"Agent",
	"Write",
	"Edit",
	"Skill",
	"AskUserQuestion",
] as const;

export type SdkToolName = (typeof SDK_TOOL_NAMES)[number];

const SDK_TOOL_NAME_SET: ReadonlySet<string> = new Set(SDK_TOOL_NAMES);

export function isMirroredSdkTool(toolName: string): toolName is SdkToolName {
	return SDK_TOOL_NAME_SET.has(toolName);
}
