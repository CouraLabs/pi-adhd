import { describe, expect, it } from "vitest";
import { formatModelId, prettyModelName } from "../../shared/model-name.ts";

describe("formatModelId", () => {
	it("strips the claude vendor prefix and joins version digits", () => {
		expect(formatModelId("claude-sonnet-4-5")).toBe("Sonnet 4.5");
		expect(formatModelId("claude-opus-4-1")).toBe("Opus 4.1");
		expect(formatModelId("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
	});

	it("keeps the single claude token when there is nothing after it", () => {
		expect(formatModelId("claude")).toBe("Claude");
	});

	it("uppercases known acronyms", () => {
		expect(formatModelId("openai-gpt-4o-mini")).toBe("Openai GPT 4o Mini");
		expect(formatModelId("zai-glm-4.5-air")).toBe("Zai GLM 4.5 Air");
		expect(formatModelId("deepseek-llm-7b")).toBe("Deepseek LLM 7b");
		expect(formatModelId("qwen-moe")).toBe("Qwen MOE");
	});

	it("strips an eight-digit date suffix", () => {
		expect(formatModelId("gpt-20250101")).toBe("GPT");
		expect(formatModelId("claude-opus-4-5-20251001")).toBe("Opus 4.5");
	});

	it("strips a latest suffix", () => {
		expect(formatModelId("claude-opus-4-1-latest")).toBe("Opus 4.1");
	});

	it("does not strip a date-like segment that is not at the end", () => {
		expect(formatModelId("gpt-20250101-mini")).toBe("GPT 20250101 Mini");
	});

	it("appends a 1M suffix for the long-context id variant", () => {
		expect(formatModelId("claude-sonnet-4-5[1m]")).toBe("Sonnet 4.5 1M");
	});

	it("matches the long-context suffix case-insensitively", () => {
		expect(formatModelId("claude-sonnet-4-5[1M]")).toBe("Sonnet 4.5 1M");
	});

	it("takes the last path segment as the id", () => {
		expect(formatModelId("anthropic/claude-sonnet-4-5")).toBe("Sonnet 4.5");
		expect(formatModelId("openai/gpt-4o")).toBe("GPT 4o");
	});

	it("splits on underscores as well as hyphens", () => {
		expect(formatModelId("meta_llama_3")).toBe("Meta Llama 3");
	});

	it("joins multi-part versions with dots", () => {
		expect(formatModelId("claude-sonnet-4-5-5")).toBe("Sonnet 4.5.5");
		expect(formatModelId("model-1-2-3")).toBe("Model 1.2.3");
	});

	it("does not join a version onto a non-numeric token", () => {
		expect(formatModelId("gpt-4o")).toBe("GPT 4o");
	});
});

describe("prettyModelName", () => {
	it("strips the Claude vendor prefix from a pretty name", () => {
		expect(prettyModelName({ id: "claude-opus-4-5", name: "Claude Opus 4.5" })).toBe("Opus 4.5");
	});

	it("matches the vendor prefix case-insensitively", () => {
		expect(prettyModelName({ id: "claude-opus-4-5", name: "claude Opus 4.5" })).toBe("Opus 4.5");
	});

	it("rewrites a (1m) name suffix to a 1M suffix", () => {
		expect(prettyModelName({ id: "claude-sonnet-4-5[1m]", name: "Claude Sonnet 4.5 (1m)" })).toBe("Sonnet 4.5 1M");
	});

	it("rewrites (1m) even without a vendor prefix", () => {
		expect(prettyModelName({ id: "claude-sonnet-4-5[1m]", name: "Sonnet 4.5 (1m)" })).toBe("Sonnet 4.5 1M");
	});

	it("returns a pretty name without a vendor prefix unchanged", () => {
		expect(prettyModelName({ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" })).toBe("Gemini 2.5 Pro");
	});

	it("falls back to formatModelId when the name equals the id", () => {
		expect(prettyModelName({ id: "claude-haiku-4-5-20251001", name: "claude-haiku-4-5-20251001" })).toBe("Haiku 4.5");
	});

	it("falls back to formatModelId when the name contains id-like punctuation", () => {
		expect(prettyModelName({ id: "claude-opus-4-5", name: "opus-4.5" })).toBe("Opus 4.5");
		expect(prettyModelName({ id: "claude-opus-4-5", name: "opus/4.5" })).toBe("Opus 4.5");
	});

	it("falls back to formatModelId when the name has no whitespace", () => {
		expect(prettyModelName({ id: "claude-opus-4-5", name: "Opus4.5" })).toBe("Opus 4.5");
	});

	it("falls back to formatModelId when the name is missing or blank", () => {
		expect(prettyModelName({ id: "claude-opus-4-5" })).toBe("Opus 4.5");
		expect(prettyModelName({ id: "claude-opus-4-5", name: "   " })).toBe("Opus 4.5");
	});
});
