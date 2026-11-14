import { describe, expect, it } from "vitest";
import { BASIC_EFFORT_LEVEL_MAP, FULL_EFFORT_LEVEL_MAP, effortForThinkingLevel } from "../../../extensions/providers/claude/effort.ts";
import { buildQueryEnv } from "../../../extensions/providers/claude/query-env.ts";

describe("effortForThinkingLevel", () => {
	it("leaves effort to Claude Code when thinking is off", () => {
		expect(effortForThinkingLevel(undefined, FULL_EFFORT_LEVEL_MAP)).toBeUndefined();
	});

	it("maps pi thinking levels onto Claude effort levels", () => {
		expect(effortForThinkingLevel("medium", FULL_EFFORT_LEVEL_MAP)).toBe("medium");
		expect(effortForThinkingLevel("max", FULL_EFFORT_LEVEL_MAP)).toBe("max");
		expect(effortForThinkingLevel("minimal", FULL_EFFORT_LEVEL_MAP)).toBe("low");
	});

	it("falls back to the nearest effort when a model marks a level unsupported", () => {
		expect(BASIC_EFFORT_LEVEL_MAP.xhigh).toBeNull();
		expect(effortForThinkingLevel("high", BASIC_EFFORT_LEVEL_MAP)).toBe("high");
	});
});

describe("buildQueryEnv", () => {
	it("clears shell overrides that would break pi's Claude session", () => {
		const env = buildQueryEnv({ PATH: "/bin", MCP_TOOL_TIMEOUT: "1000", CLAUDE_CODE_EFFORT_LEVEL: "low", CLAUDE_CODE_SIMPLE: "1" });
		expect(env.PATH).toBe("/bin");
		expect(env.MCP_TOOL_TIMEOUT).toBeUndefined();
		expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
		expect(env.CLAUDE_CODE_SIMPLE).toBeUndefined();
		expect(env.ENABLE_TOOL_SEARCH).toBe("false");
	});
});
