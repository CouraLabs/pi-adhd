import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import type { DefaultModelRef, ModelRegistry } from "../../shared/model-resolver.ts";
import { resolveInvocationModel, resolveModel } from "../../shared/model-resolver.ts";

function asModel(value: { provider: string; id: string; name: string }): Model<any> {
	return value as unknown as Model<any>;
}

const gpt4o = asModel({ provider: "openai", id: "gpt-4o", name: "GPT-4o" });
const gpt4oMini = asModel({ provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" });
const sonnet = asModel({ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" });

function registryWith(models: Model<any>[]): ModelRegistry {
	return {
		find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
		getAll: () => models,
		getAvailable: () => models,
	};
}

describe("resolveModel", () => {
	it("returns the exact provider/id hit", () => {
		const registry = registryWith([gpt4o, sonnet]);
		expect(resolveModel("openai/gpt-4o", registry)).toBe(gpt4o);
	});

	it("fuzzy-matches a substring of the model id", () => {
		const registry = registryWith([gpt4oMini, sonnet]);
		expect(resolveModel("4o-mini", registry)).toBe(gpt4oMini);
	});

	it("fuzzy-matches the full provider/id string", () => {
		const registry = registryWith([gpt4o, sonnet]);
		expect(resolveModel("openai/gpt-4o", registry)).toBe(gpt4o);
	});

	it("fuzzy-matches a substring of the display name", () => {
		const registry = registryWith([gpt4o, sonnet]);
		expect(resolveModel("sonnet", registry)).toBe(sonnet);
	});

	it("matches multi-word queries across id and name parts", () => {
		const registry = registryWith([gpt4oMini, sonnet]);
		expect(resolveModel("gpt mini", registry)).toBe(gpt4oMini);
	});

	it("returns an error string listing available models when nothing matches", () => {
		const result = resolveModel("zzz-nonexistent", registryWith([gpt4o, sonnet]));
		expect(typeof result).toBe("string");
		const message = result as string;
		expect(message).toContain('Model not found: "zzz-nonexistent"');
		expect(message).toContain("openai/gpt-4o");
		expect(message).toContain("anthropic/claude-sonnet-4");
	});
});

describe("resolveInvocationModel", () => {
	it("returns the parent model when no modelInput is given", () => {
		const result = resolveInvocationModel(gpt4o, undefined, false, undefined);
		expect(result).toEqual({ model: gpt4o });
	});

	it("errors when the registry is missing and the model came from params", () => {
		const result = resolveInvocationModel(gpt4o, "anthropic/claude-sonnet-4", true, undefined);
		expect(result).toEqual({ error: "No model registry available." });
	});

	it("falls back to the parent model with a note when the registry is missing and the model came from agent config", () => {
		const result = resolveInvocationModel(gpt4o, "anthropic/claude-sonnet-4", false, undefined);
		expect(result).toEqual({
			model: gpt4o,
			fallbackNote: expect.stringContaining('Agent model "anthropic/claude-sonnet-4" could not be resolved'),
		});
	});

	it("errors on unresolvable input when the model came from params", () => {
		const result = resolveInvocationModel(
			gpt4o,
			"zzz-nonexistent",
			true,
			registryWith([sonnet]),
		);
		expect(result).toMatchObject({ error: expect.stringContaining('Model not found: "zzz-nonexistent"') });
	});

	it("falls back to the parent model with a note on unresolvable agent-config input", () => {
		const result = resolveInvocationModel(
			gpt4o,
			"zzz-nonexistent",
			false,
			registryWith([sonnet]),
		);
		expect(result).toEqual({
			model: gpt4o,
			fallbackNote: expect.stringContaining('Agent model "zzz-nonexistent" did not match'),
		});
	});

	it("returns the resolved model on a registry hit", () => {
		const result = resolveInvocationModel(
			gpt4o,
			"anthropic/claude-sonnet-4",
			true,
			registryWith([sonnet]),
		);
		expect(result).toEqual({ model: sonnet });
	});

	it("returns the parent model for the inherit sentinel", () => {
		const result = resolveInvocationModel(
			gpt4o,
			"inherit",
			true,
			registryWith([sonnet]),
		);
		expect(result).toEqual({ model: gpt4o });
	});

	it("resolves the default sentinel to the configured default model", () => {
		const defaultModelRef: DefaultModelRef = { provider: "anthropic", id: "claude-sonnet-4" };
		const result = resolveInvocationModel(
			gpt4o,
			"default",
			true,
			registryWith([sonnet]),
			defaultModelRef,
		);
		expect(result).toEqual({ model: sonnet });
	});

	it("errors on the default sentinel when no default model is configured", () => {
		const result = resolveInvocationModel(gpt4o, "default", false, registryWith([sonnet]), undefined);
		expect(result).toMatchObject({
			error: expect.stringContaining('"default" is set but no default model is configured'),
		});
	});

	it("errors on the default sentinel when the configured default is missing from the registry", () => {
		const defaultModelRef: DefaultModelRef = { provider: "openai", id: "gpt-4o" };
		const result = resolveInvocationModel(
			gpt4o,
			"default",
			true,
			registryWith([sonnet]),
			defaultModelRef,
		);
		expect(result).toMatchObject({
			error: expect.stringContaining('"openai/gpt-4o"'),
		});
	});

	it("treats sentinels case-sensitively and trims surrounding whitespace", () => {
		const result = resolveInvocationModel(gpt4o, " inherit ", false, registryWith([sonnet]));
		expect(result).toEqual({ model: gpt4o });
		const misspelled = resolveInvocationModel(gpt4o, "Inherit", false, registryWith([sonnet]));
		expect(misspelled).toMatchObject({ fallbackNote: expect.any(String) });
	});
});
