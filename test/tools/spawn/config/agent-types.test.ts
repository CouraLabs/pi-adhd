import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { AgentTypeRegistry, BUILTIN_TOOL_NAMES } from "../../../../extensions/tools/spawn/config/agent-types.ts";

function agentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "helper",
		description: "helper agent",
		systemPrompt: "helper prompt",
		promptMode: "append",
		source: "global",
		...overrides,
	};
}

function registryFrom(...groups: [string, AgentConfig][]): AgentTypeRegistry {
	return new AgentTypeRegistry(() => new Map(groups));
}

describe("AgentTypeRegistry", () => {
	it("loads agents from the injected loader", () => {
		const registry = registryFrom(["helper", agentConfig()]);
		expect(registry.resolveType("helper")).toBe("helper");
		expect(registry.getAvailableTypes()).toEqual(["helper"]);
	});

	it("reloads from the loader on reload()", () => {
		const entries: [string, AgentConfig][] = [];
		const registry = new AgentTypeRegistry(() => new Map(entries));
		expect(registry.resolveType("helper")).toBeUndefined();
		entries.push(["helper", agentConfig()]);
		registry.reload();
		expect(registry.resolveType("helper")).toBe("helper");
	});

	it("resolves types case-insensitively", () => {
		const registry = registryFrom(
			["Code-Review", agentConfig({ name: "Code-Review", description: "reviews code" })],
			["qa", agentConfig({ name: "qa", description: "tests ui" })],
		);
		expect(registry.resolveType("CODE-REVIEW")).toBe("Code-Review");
		expect(registry.resolveType("QA")).toBe("qa");
		expect(registry.resolveType("nonexistent")).toBeUndefined();
	});

	it("hides enabled:false agents from getAvailableTypes and list stays complete", () => {
		const registry = registryFrom(
			["helper", agentConfig({ enabled: false })],
			["visible", agentConfig({ name: "visible", description: "visible agent" })],
		);
		expect(registry.getAvailableTypes()).toEqual(["visible"]);
		expect(registry.list().map((config) => config.name)).toEqual(["helper", "visible"]);
		expect(registry.isValidType("helper")).toBe(false);
		expect(registry.isValidType("visible")).toBe(true);
		expect(registry.isValidType("nonexistent")).toBe(false);
	});

	it("lets project entries replace same-name global entries via the loader map", () => {
		const registry = registryFrom(
			["helper", agentConfig({ description: "global helper", source: "global" })],
			["helper", agentConfig({ description: "project helper", source: "project" })],
		);
		const config = registry.resolveAgentConfig("helper");
		expect(config?.description).toBe("project helper");
		expect(config?.source).toBe("project");
	});

	it("falls back to general-purpose for unknown types when present and enabled", () => {
		const registry = registryFrom(
			["helper", agentConfig()],
			["general-purpose", agentConfig({ name: "general-purpose", description: "general agent" })],
		);
		expect(registry.resolveAgentConfig("whoever")?.name).toBe("general-purpose");
	});

	it("returns undefined for unknown types when general-purpose is absent", () => {
		const registry = registryFrom(["helper", agentConfig()]);
		expect(registry.resolveAgentConfig("whoever")).toBeUndefined();
	});

	it("returns undefined for unknown types when general-purpose is disabled", () => {
		const registry = registryFrom([
			"general-purpose",
			agentConfig({ name: "general-purpose", enabled: false }),
		]);
		expect(registry.resolveAgentConfig("whoever")).toBeUndefined();
	});

	it("resolves known types directly even when disabled", () => {
		const registry = registryFrom(
			["helper", agentConfig({ enabled: false })],
			["general-purpose", agentConfig({ name: "general-purpose", description: "general agent" })],
		);
		expect(registry.resolveAgentConfig("helper")?.name).toBe("helper");
	});

	it("returns all parent tool names for allTools agents", () => {
		const registry = registryFrom(["helper", agentConfig({ allTools: true })]);
		const parentTools = ["read", "bash", "spawn", "mcp__x__y"];
		expect(registry.getToolNamesForType("helper", parentTools)).toEqual(parentTools);
		expect(registry.getToolNamesForType("helper", parentTools)).not.toBe(parentTools);
	});

	it("returns configured tool names when toolNames is set", () => {
		const registry = registryFrom([
			"helper",
			agentConfig({ toolNames: ["read", "grep"] }),
		]);
		expect(registry.getToolNamesForType("helper", ["read", "bash", "edit"])).toEqual(["read", "grep"]);
	});

	it("returns the builtin tool list when toolNames is omitted", () => {
		const registry = registryFrom(["helper", agentConfig()]);
		expect(registry.getToolNamesForType("helper", ["read", "bash", "spawn"])).toEqual([
			...BUILTIN_TOOL_NAMES,
		]);
	});

	it("returns no tools for tools: none via toolNames: []", () => {
		const registry = registryFrom(["helper", agentConfig({ toolNames: [] })]);
		expect(registry.getToolNamesForType("helper", ["read", "bash"])).toEqual([]);
	});

	it("returns the builtin tool list when the type resolves to nothing", () => {
		const registry = registryFrom(["helper", agentConfig()]);
		expect(registry.getToolNamesForType("whoever", ["read", "bash"])).toEqual([...BUILTIN_TOOL_NAMES]);
	});
});
