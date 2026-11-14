const PI_OWNED_ENV: Readonly<Record<string, string | undefined>> = {
	ENABLE_TOOL_SEARCH: "false",
	CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: "1",
	CLAUDE_CODE_SIMPLE: undefined,
	CLAUDE_CODE_EFFORT_LEVEL: undefined,
	MCP_TOOL_TIMEOUT: undefined,
};

export function buildQueryEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
	return { ...base, ...PI_OWNED_ENV };
}
