import { agentDirState } from "../../../helpers/agent-dir.ts";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { AgentTypeRegistry, BUILTIN_TOOL_NAMES } from "../../../../extensions/tools/spawn/config/agent-types.ts";
import { DEFAULT_AGENTS } from "../../../../extensions/tools/spawn/config/default-agents.ts";

function userAgents(entries: [string, AgentConfig][]): () => Map<string, AgentConfig> {
	return () => new Map(entries);
}

function userAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "helper",
		description: "user agent",
		systemPrompt: "user prompt",
		promptMode: "append",
		source: "project",
		...overrides,
	};
}

describe("AgentTypeRegistry", () => {
	beforeAll(() => {
		agentDirState.dir = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	});

	afterAll(() => {
		rmSync(agentDirState.dir, { recursive: true, force: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers all default agents on construction", () => {
		const registry = new AgentTypeRegistry(() => new Map());
		for (const name of DEFAULT_AGENTS.keys()) {
			expect(registry.resolveType(name)).toBe(name);
		}
	});

	it("resolves types case-insensitively", () => {
		const registry = new AgentTypeRegistry(() => new Map());
		expect(registry.resolveType("ARQUITECT")).toBe("Arquitect");
		expect(registry.resolveType("code-review")).toBe("Code-Review");
		expect(registry.resolveType("QA")).toBe("qa");
		expect(registry.resolveType("nonexistent")).toBeUndefined();
	});

	it("excludes enabled:false agents from getAvailableTypes and isValidType", () => {
		const registry = new AgentTypeRegistry(
			userAgents([["helper", userAgent({ enabled: false })]]),
		);
		expect(registry.getAvailableTypes()).not.toContain("helper");
		expect(registry.getAvailableTypes()).toContain("general-purpose");
		expect(registry.isValidType("helper")).toBe(false);
		expect(registry.isValidType("general-purpose")).toBe(true);
	});

	it("lets user agents override defaults and add new ones", () => {
		const override = userAgent({
			name: "general-purpose",
			description: "custom override",
			systemPrompt: "",
		});
		const registry = new AgentTypeRegistry(
			userAgents([
				["general-purpose", override],
				["helper", userAgent()],
			]),
		);
		expect(registry.resolveAgentConfig("general-purpose").description).toBe("custom override");
		expect(registry.resolveType("helper")).toBe("helper");
		expect(registry.getUserAgentNames()).toEqual(["general-purpose", "helper"]);
		expect(registry.getDefaultAgentNames()).not.toContain("general-purpose");
	});

	it("returns tool names from the config or the builtin default", () => {
		const registry = new AgentTypeRegistry(() => new Map());
		expect(registry.getToolNamesForType("plan-reviewer")).toEqual([
			"read",
			"bash",
			"grep",
			"find",
			"ls",
		]);
		expect(registry.getToolNamesForType("general-purpose")).toEqual(BUILTIN_TOOL_NAMES);
	});

	it("applies agent model and thinking loaders to default agents", () => {
		const registry = new AgentTypeRegistry(
			() => new Map(),
			() => ({ "general-purpose": "openai/gpt-4o" }),
			() => ({ "general-purpose": "high" }),
		);
		const config = registry.resolveAgentConfig("general-purpose");
		expect(config.model).toBe("openai/gpt-4o");
		expect(config.thinking).toBe("high");
	});

	it("does not apply model or thinking loaders to user agents", () => {
		const registry = new AgentTypeRegistry(
			userAgents([["helper", userAgent({ name: "helper" })]]),
			() => ({ helper: "openai/gpt-4o" }),
			() => ({ helper: "low" }),
		);
		const config = registry.resolveAgentConfig("helper");
		expect(config.model).toBeUndefined();
		expect(config.thinking).toBeUndefined();
	});

	it("falls back to general-purpose for unknown types", () => {
		const registry = new AgentTypeRegistry(() => new Map());
		expect(registry.resolveAgentConfig("whoever").name).toBe("general-purpose");
	});

	it("reloads from the user-agent loader on reload()", () => {
		const entries: [string, AgentConfig][] = [];
		const registry = new AgentTypeRegistry(() => new Map(entries));
		expect(registry.resolveType("helper")).toBeUndefined();
		entries.push(["helper", userAgent()]);
		registry.reload();
		expect(registry.resolveType("helper")).toBe("helper");
	});

	it("offloads default agent system prompts to files under the agent dir", () => {
		new AgentTypeRegistry(() => new Map());
		const promptsDir = join(dirname(agentDirState.dir), "couralabs", "prompts", "subagents");
		const offloaded = join(promptsDir, "plan-reviewer.md");
		expect(existsSync(offloaded)).toBe(true);
		const config = new AgentTypeRegistry(() => new Map()).resolveAgentConfig("plan-reviewer");
		expect(config.systemPrompt).toBe(readFileSync(offloaded, "utf8"));
		expect(config.systemPrompt).toContain("practical");
	});
});
