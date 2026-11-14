import { describe, expect, it } from "vitest";
import type { Api, Model } from "@earendil-works/pi-ai";
import { buildQueryOptions } from "../../../extensions/providers/claude/bridge.ts";
import { PiToolServer } from "../../../extensions/providers/claude/pi-mcp.ts";
import { RESPONSE_STYLE_RULES, taggedResponseStyle } from "../../../shared/response-style.ts";
import { setSubmode } from "../../../shared/submodes.ts";

const MODEL = { id: "claude-haiku-5-5", api: "claude-agent-sdk", provider: "claude" } as Model<Api>;

function systemPromptFor() {
	return buildQueryOptions(MODEL, new AbortController(), false, undefined, new PiToolServer({}), "session", process.cwd(), false, undefined, undefined)
		.systemPrompt;
}

describe("Claude system prompt", () => {
	it("appends only the response-style rules to Claude Code's preset", () => {
		expect(systemPromptFor()).toEqual({ type: "preset", preset: "claude_code", append: taggedResponseStyle() });
	});

	it("does not append submode instructions while a submode is active", () => {
		setSubmode("plan");
		try {
			expect(systemPromptFor()).toEqual({ type: "preset", preset: "claude_code", append: taggedResponseStyle() });
		} finally {
			setSubmode("none");
		}
	});

	it("carries all four response rules", () => {
		expect(taggedResponseStyle()).toBe(`<response_style>\n${RESPONSE_STYLE_RULES}\n</response_style>`);
		for (const heading of ["Lead with the answer", "Structure complex answers as steps", "Keep full technical density", "End with one strategic next step"]) {
			expect(RESPONSE_STYLE_RULES).toContain(heading);
		}
	});
});
