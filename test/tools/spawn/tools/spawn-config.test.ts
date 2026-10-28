import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { AgentTypeRegistry } from "../../../../extensions/tools/spawn/config/agent-types.ts";
import type { ModelInfo } from "../../../../extensions/tools/spawn/tools/spawn-config.ts";
import { resolveSpawnConfig } from "../../../../extensions/tools/spawn/tools/spawn-config.ts";

function asModel(value: { provider: string; id: string; name: string }): Model<any> {
	return value as unknown as Model<any>;
}

const parent = asModel({ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" });
const gpt4o = asModel({ provider: "openai", id: "gpt-4o", name: "GPT-4o" });
const defaultModel = asModel({ provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini" });

function registryWith(models: Model<any>[]) {
	return {
		find: (provider: string, id: string) => models.find((m) => m.provider === provider && m.id === id),
		getAll: () => models,
		getAvailable: () => models,
	};
}

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

function modelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		parentModel: parent,
		modelRegistry: registryWith([parent, gpt4o, defaultModel]),
		defaultModelRef: { provider: "openai", id: "gpt-5-mini" },
		...overrides,
	};
}

const settings = { defaultMaxTurns: undefined };

function baseParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		prompt: "do the thing",
		description: "thing",
		spawn_type: "helper",
		...overrides,
	};
}

describe("resolveSpawnConfig agent type validation", () => {
	it("errors on an unknown type when no enabled general-purpose agent exists", () => {
		const result = resolveSpawnConfig(
			baseParams({ spawn_type: "nope" }),
			registryFrom(["helper", agentConfig()]),
			modelInfo(),
			settings,
		);
		expect(result).toEqual({
			error: 'Unknown agent type "nope" and no general-purpose agent is defined.',
		});
	});

	it("falls back to general-purpose on an unknown type when general-purpose is enabled", () => {
		const result = resolveSpawnConfig(
			baseParams({ spawn_type: "nope" }),
			registryFrom(
				["helper", agentConfig()],
				["general-purpose", agentConfig({ name: "general-purpose" })],
			),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.identity.spawnType).toBe("general-purpose");
		expect(result.identity.fellBack).toBe(true);
		expect(result.notes).toContain('Note: Unknown agent type "nope" — using general-purpose.');
	});

	it("errors when a directly requested agent is disabled", () => {
		const result = resolveSpawnConfig(
			baseParams({ spawn_type: "retired" }),
			registryFrom(
				["retired", agentConfig({ name: "retired", enabled: false })],
				["general-purpose", agentConfig({ name: "general-purpose" })],
			),
			modelInfo(),
			settings,
		);
		expect(result).toEqual({
			error: 'Agent "retired" is disabled (enabled: false in its agent file).',
		});
	});

	it("falls back to general-purpose on an unknown type even when another agent is disabled", () => {
		const result = resolveSpawnConfig(
			baseParams({ spawn_type: "nope" }),
			registryFrom(
				["retired", agentConfig({ name: "retired", enabled: false })],
				["general-purpose", agentConfig({ name: "general-purpose" })],
			),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.identity.spawnType).toBe("general-purpose");
		expect(result.identity.fellBack).toBe(true);
	});
});

describe("resolveSpawnConfig model resolution", () => {
	it("lets the caller model beat the agent frontmatter model", () => {
		const result = resolveSpawnConfig(
			baseParams({ model: "openai/gpt-4o" }),
			registryFrom(["helper", agentConfig({ model: "anthropic/claude-sonnet-4" })]),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.execution.model).toBe(gpt4o);
	});

	it("uses the agent frontmatter model when the caller omits it", () => {
		const result = resolveSpawnConfig(
			baseParams(),
			registryFrom(["helper", agentConfig({ model: "openai/gpt-4o" })]),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.execution.model).toBe(gpt4o);
	});

	it("resolves the agent frontmatter default sentinel through the configured default model", () => {
		const result = resolveSpawnConfig(
			baseParams(),
			registryFrom(["helper", agentConfig({ model: "default" })]),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.execution.model).toBe(defaultModel);
	});

	it("errors when the frontmatter default sentinel has no configured default model", () => {
		const result = resolveSpawnConfig(
			baseParams(),
			registryFrom(["helper", agentConfig({ model: "default" })]),
			modelInfo({ defaultModelRef: undefined }),
			settings,
		);
		expect(result).toMatchObject({
			error: expect.stringContaining('"default" is set but no default model is configured'),
		});
	});

	it("falls back to the parent model with a note when the caller omits model and the agent has none", () => {
		const result = resolveSpawnConfig(
			baseParams(),
			registryFrom(["helper", agentConfig()]),
			modelInfo(),
			settings,
		);
		if ("error" in result) throw new Error(`expected success, got: ${result.error}`);
		expect(result.execution.model).toBe(parent);
		expect(result.notes).toEqual([]);
	});
});
