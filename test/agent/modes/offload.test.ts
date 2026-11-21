import { agentDirState } from "../../helpers/agent-dir.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../../../shared/model-resolver.ts";
import registerModes from "../../../extensions/agent/modes/index.ts";
import { resolveModeModelSwitch } from "../../../extensions/agent/modes/model-switch.ts";
import { listAgentModes, readModeDeclaration, readModePrompt, userModesDir } from "../../../shared/modes.ts";

let tempRoot = "";

function fakePi(): ExtensionAPI {
	return {
		on: () => {},
		registerCommand: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
}

beforeEach(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "pi-adhd-modes-"));
	agentDirState.dir = join(tempRoot, "agent");
});

afterEach(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

describe("packaged mode offloading", () => {
	it("creates work.md and manager.md on a clean prompts dir", () => {
		registerModes(fakePi());
		expect(existsSync(join(userModesDir(), "work.md"))).toBe(true);
		expect(existsSync(join(userModesDir(), "manager.md"))).toBe(true);
		expect(listAgentModes()).toEqual(["manager", "pi", "work"]);
		expect(readModeDeclaration("manager")).toEqual({ model: "default" });
		expect(readModePrompt("manager")).toContain("You are the development task manager.");
	});

	it("switches Manager to the configured default model", () => {
		registerModes(fakePi());
		const current = { provider: "openai", id: "gpt-4o", name: "GPT-4o" } as unknown as Model<any>;
		const fallback = { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" } as unknown as Model<any>;
		const registry: ModelRegistry = {
			find: (provider, id) => [current, fallback].find((m) => m.provider === provider && m.id === id),
			getAll: () => [current, fallback],
			getAvailable: () => [current, fallback],
		};
		const result = resolveModeModelSwitch(readModeDeclaration("manager"), current, registry, {
			provider: "anthropic",
			id: "claude-sonnet-4",
		});
		expect(result.switchTo).toBe(fallback);
	});

	it("leaves an existing user manager.md untouched", () => {
		const own = "---\nmodel: some/other-model\n---\nmy manager\n";
		mkdirSync(userModesDir(), { recursive: true });
		writeFileSync(join(userModesDir(), "manager.md"), own, "utf8");
		registerModes(fakePi());
		expect(readFileSync(join(userModesDir(), "manager.md"), "utf8")).toBe(own);
		expect(existsSync(join(userModesDir(), "work.md"))).toBe(true);
	});
});
