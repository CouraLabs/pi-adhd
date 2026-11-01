import { describe, expect, it } from "vitest";
import { OPENCODE_FREE_MODEL_IDS, selectFreeModels, staticFreeModels } from "../../../extensions/providers/opencode/catalog.ts";

const priced = (id: string, input: number, output: number) => ({
	id,
	cost: { text: { input: { price: input }, output: { price: output } } },
	limit: { context: 100000, output: 16000 },
});

describe("opencode catalog", () => {
	it("ships eight known free ids as offline fallback", () => {
		expect(OPENCODE_FREE_MODEL_IDS).toHaveLength(8);
		expect(staticFreeModels("https://opencode.ai/inference/v1")).toHaveLength(8);
	});

	it("treats zero-price entries as free", () => {
		const models = selectFreeModels({ data: [priced("glm-5.3-flash-free", 0, 0), priced("gpt-5", 1.25, 10)] }, "https://base/v1");
		expect(models.map((model) => model.id)).toEqual(["glm-5.3-flash-free"]);
	});

	it("keeps big-pickle without a free suffix", () => {
		const models = selectFreeModels({ data: [{ id: "big-pickle" }] }, "https://base/v1");
		expect(models.map((model) => model.id)).toEqual(["big-pickle"]);
	});

	it("returns nothing for malformed payloads", () => {
		expect(selectFreeModels({ data: "nope" }, "https://base/v1")).toEqual([]);
		expect(selectFreeModels({}, "https://base/v1")).toEqual([]);
	});
});
