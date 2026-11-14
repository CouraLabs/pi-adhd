import { agentDirState } from "../../helpers/agent-dir.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerModes from "../../../extensions/agent/modes/index.ts";
import { CLAUDE_MODE, GOOGLE_MODE, PI_MODE, setAgentMode } from "../../../shared/modes.ts";
import { RESPONSE_STYLE_RULES, RESPONSE_STYLE_SECTION } from "../../../shared/response-style.ts";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

type Handler = (event: unknown, context?: unknown) => unknown;

let root = "";
const handlers = new Map<string, Handler>();

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(root, "agent");
	const pi = {
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		registerCommand: () => undefined,
		appendEntry: () => undefined,
	} as unknown as ExtensionAPI;
	registerModes(pi);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

function promptOptionsFor(mode: string) {
	setAgentMode(mode);
	const event = { systemPromptOptions: { sections: {} as Record<string, string>, customPrompt: undefined as string | undefined } };
	handlers.get("before_agent_start")?.(event);
	return event.systemPromptOptions;
}

describe("response style outside the Claude agent", () => {
	it("is appended as a section in Work mode alongside the mode prompt", () => {
		const options = promptOptionsFor("work");
		expect(options.sections[RESPONSE_STYLE_SECTION]).toBe(RESPONSE_STYLE_RULES);
		expect(options.customPrompt).toContain("Session Rules");
	});

	it("is appended in plain pi mode without replacing pi's prompt", () => {
		const options = promptOptionsFor(PI_MODE);
		expect(options.sections[RESPONSE_STYLE_SECTION]).toBe(RESPONSE_STYLE_RULES);
		expect(options.customPrompt).toBeUndefined();
	});

	it("is left to the provider when Claude or agy owns the system prompt", () => {
		expect(promptOptionsFor(CLAUDE_MODE).sections[RESPONSE_STYLE_SECTION]).toBeUndefined();
		expect(promptOptionsFor(GOOGLE_MODE).sections[RESPONSE_STYLE_SECTION]).toBeUndefined();
	});
});
