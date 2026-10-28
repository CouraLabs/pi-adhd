import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "../../../shared/model-resolver.ts";
import { resolveModeModelSwitch } from "../../../extensions/agent/modes/model-switch.ts";

function asModel(value: { provider: string; id: string; name: string }): Model<any> {
	return value as unknown as Model<any>;
}

const gpt4o = asModel({ provider: "openai", id: "gpt-4o", name: "GPT-4o" });
const sonnet = asModel({ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" });
const claudeModel = asModel({ provider: "claude", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" });

function registryWith(models: Model<any>[]): ModelRegistry {
	return {
		find: (provider, id) => models.find((m) => m.provider === provider && m.id === id),
		getAll: () => models,
		getAvailable: () => models,
	};
}

const registry = registryWith([gpt4o, sonnet, claudeModel]);

describe("resolveModeModelSwitch", () => {
	it("returns an error when the declaration cannot be read", () => {
		const result = resolveModeModelSwitch(undefined, gpt4o, registry);
		expect(result.error).toBeDefined();
		expect(result.switchTo).toBeUndefined();
	});

	it("returns the declaration error verbatim", () => {
		const result = resolveModeModelSwitch({ error: "bad frontmatter" }, gpt4o, registry);
		expect(result).toEqual({ error: "bad frontmatter" });
	});

	it("returns unchanged when the mode declares no model", () => {
		const result = resolveModeModelSwitch({}, gpt4o, registry);
		expect(result).toEqual({ unchanged: true });
	});

	it("treats an empty-string model as absent", () => {
		const result = resolveModeModelSwitch({ model: "" }, gpt4o, registry);
		expect(result).toEqual({ unchanged: true });
	});

	it("turns a fallbackNote for an unresolvable name into an error", () => {
		const result = resolveModeModelSwitch({ model: "zzz-nonexistent" }, gpt4o, registry);
		expect(result.error).toContain("zzz-nonexistent");
		expect(result.switchTo).toBeUndefined();
	});

	it("returns the resolver error for an unresolvable model input", () => {
		const result = resolveModeModelSwitch({ model: "default" }, gpt4o, registry);
		expect(result.error).toContain("no default model is configured");
	});

	it("returns switchTo when the model resolves and differs from the current model", () => {
		const result = resolveModeModelSwitch({ model: "anthropic/claude-sonnet-4" }, gpt4o, registry);
		expect(result.switchTo).toBe(sonnet);
	});

	it("returns unchanged when the resolved model matches the current provider and id", () => {
		const result = resolveModeModelSwitch({ model: "openai/gpt-4o" }, gpt4o, registry);
		expect(result).toEqual({ unchanged: true });
	});

	it("allows claude-provider models with no special-casing", () => {
		const result = resolveModeModelSwitch({ model: "claude/claude-sonnet-4-5" }, gpt4o, registry);
		expect(result.switchTo).toBe(claudeModel);
	});

	it("errors on model \"default\" when no defaultModelRef is configured", () => {
		const result = resolveModeModelSwitch({ model: "default" }, gpt4o, registry, undefined);
		expect(result.error).toContain("no default model is configured");
	});

	it("resolves model \"default\" through the configured defaultModelRef", () => {
		const result = resolveModeModelSwitch({ model: "default" }, gpt4o, registry, {
			provider: "anthropic",
			id: "claude-sonnet-4",
		});
		expect(result.switchTo).toBe(sonnet);
	});
});
