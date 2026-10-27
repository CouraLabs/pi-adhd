import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getFetchConfig, getSearchConfig, saveFetchConfig, saveSearchConfig } from "../../extensions/tools/web/config.ts";
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

let root = "";

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(root, "agent");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
	rmSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true, force: true });
});

describe("getFetchConfig", () => {
	it("defaults to provider auto and exa model", () => {
		expect(getFetchConfig()).toEqual({ provider: "auto", nineRouterModel: "exa" });
	});
});

describe("getSearchConfig", () => {
	it("defaults to provider auto and exa model", () => {
		expect(getSearchConfig()).toEqual({ provider: "auto", nineRouterModel: "exa" });
	});
});

describe("saveFetchConfig", () => {
	it("persists a partial patch without clobbering search", () => {
		saveFetchConfig({ provider: "jina" });
		expect(getFetchConfig()).toEqual({ provider: "jina", nineRouterModel: "exa" });
		expect(getSearchConfig()).toEqual({ provider: "auto", nineRouterModel: "exa" });

		saveFetchConfig({ nineRouterModel: "perplexity" });
		expect(getFetchConfig()).toEqual({ provider: "jina", nineRouterModel: "perplexity" });
		expect(getSearchConfig()).toEqual({ provider: "auto", nineRouterModel: "exa" });
	});
});

describe("saveSearchConfig", () => {
	it("persists a partial patch without clobbering fetch", () => {
		saveFetchConfig({ provider: "jina" });
		saveSearchConfig({ provider: "brave" });
		expect(getSearchConfig()).toEqual({ provider: "brave", nineRouterModel: "exa" });
		expect(getFetchConfig()).toEqual({ provider: "jina", nineRouterModel: "exa" });
	});
});
