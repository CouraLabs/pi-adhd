import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { resolveInvocationOverrides } from "../../../../extensions/tools/spawn/config/invocation-overrides.ts";

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "worker",
		description: "test agent",
		systemPrompt: "",
		promptMode: "append",
		...overrides,
	};
}

describe("resolveInvocationOverrides", () => {
	it("lets the caller win over frontmatter for every field", () => {
		const result = resolveInvocationOverrides(
			agent({ model: "agent-model", thinking: "high", maxTurns: 3, inheritContext: true }),
			{ model: "caller-model", thinking: "low", max_turns: 9, inherit_context: false },
		);
		expect(result.modelInput).toBe("caller-model");
		expect(result.modelFromParams).toBe(true);
		expect(result.thinking).toBe("low");
		expect(result.maxTurns).toBe(9);
		expect(result.inheritContext).toBe(false);
	});

	it("uses the frontmatter values when the caller omits the fields", () => {
		const result = resolveInvocationOverrides(
			agent({ model: "agent-model", thinking: "high", maxTurns: 3, inheritContext: true }),
			{},
		);
		expect(result.modelInput).toBe("agent-model");
		expect(result.modelFromParams).toBe(false);
		expect(result.thinking).toBe("high");
		expect(result.maxTurns).toBe(3);
		expect(result.inheritContext).toBe(true);
	});

	it("falls back when neither the caller nor the frontmatter provides a value", () => {
		const result = resolveInvocationOverrides(agent(), {});
		expect(result.modelInput).toBeUndefined();
		expect(result.modelFromParams).toBe(false);
		expect(result.thinking).toBeUndefined();
		expect(result.maxTurns).toBeUndefined();
		expect(result.inheritContext).toBe(false);
	});

	it("reports modelFromParams only for caller-provided models", () => {
		expect(resolveInvocationOverrides(agent({ model: "agent-model" }), {}).modelFromParams).toBe(
			false,
		);
		expect(resolveInvocationOverrides(agent(), { model: "caller-model" }).modelFromParams).toBe(
			true,
		);
	});

	it("lets the caller disable frontmatter-inherited context", () => {
		const result = resolveInvocationOverrides(agent({ inheritContext: true }), {
			inherit_context: false,
		});
		expect(result.inheritContext).toBe(false);
	});
});
