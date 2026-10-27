import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { resolveAgentInvocationConfig } from "../../../../extensions/tools/spawn/config/invocation-config.ts";

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "worker",
		description: "test agent",
		systemPrompt: "",
		promptMode: "append",
		...overrides,
	};
}

describe("resolveAgentInvocationConfig", () => {
	it("lets the caller win when fields are not locked", () => {
		const result = resolveAgentInvocationConfig(agent({ model: "agent-model", maxTurns: 3 }), {
			model: "caller-model",
			max_turns: 9,
		});
		expect(result.modelInput).toBe("caller-model");
		expect(result.modelFromParams).toBe(true);
		expect(result.maxTurns).toBe(9);
		expect(result.discarded).toEqual([]);
	});

	it("locks every field that has an agent value when locked is true", () => {
		const result = resolveAgentInvocationConfig(
			agent({
				model: "agent-model",
				thinking: "high",
				maxTurns: 3,
				inheritContext: true,
				locked: true,
			}),
			{ model: "caller-model", thinking: "low", max_turns: 9, inherit_context: false },
		);
		expect(result.modelInput).toBe("agent-model");
		expect(result.thinking).toBe("high");
		expect(result.maxTurns).toBe(3);
		expect(result.inheritContext).toBe(true);
		expect(result.discarded).toEqual(["model", "thinking", "max_turns", "inherit_context"]);
	});

	it("does not report discarded values when the caller matches the locked value", () => {
		const result = resolveAgentInvocationConfig(agent({ model: "same", locked: true }), {
			model: "same",
		});
		expect(result.modelInput).toBe("same");
		expect(result.discarded).toEqual([]);
	});

	it("locks only the fields listed in a locked array", () => {
		const result = resolveAgentInvocationConfig(
			agent({ model: "agent-model", thinking: "high", locked: ["model"] }),
			{ model: "caller-model", thinking: "low" },
		);
		expect(result.modelInput).toBe("agent-model");
		expect(result.thinking).toBe("low");
		expect(result.discarded).toEqual(["model"]);
	});

	it("defaults inheritContext to false", () => {
		expect(resolveAgentInvocationConfig(agent(), {}).inheritContext).toBe(false);
		expect(resolveAgentInvocationConfig(agent({ inheritContext: true }), {}).inheritContext).toBe(
			true,
		);
	});

	it("leaves model, thinking, and maxTurns undefined when neither side provides them", () => {
		const result = resolveAgentInvocationConfig(agent(), {});
		expect(result.modelInput).toBeUndefined();
		expect(result.modelFromParams).toBe(false);
		expect(result.thinking).toBeUndefined();
		expect(result.maxTurns).toBeUndefined();
		expect(result.discarded).toEqual([]);
	});
});
