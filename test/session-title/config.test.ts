import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSessionTitleConfig, saveSessionTitleConfig } from "../../extensions/ui/session-title/config.ts";
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

describe("loadSessionTitleConfig", () => {
	it("defaults to enabled", () => {
		expect(loadSessionTitleConfig()).toEqual({ enabled: true });
	});
});

describe("saveSessionTitleConfig", () => {
	it("persists a model patch and returns the updated config", () => {
		const updated = saveSessionTitleConfig({ model: "x" });
		expect(updated).toEqual({ enabled: true, model: "x" });
		expect(loadSessionTitleConfig()).toEqual({ enabled: true, model: "x" });
	});

	it("persists enabled false", () => {
		saveSessionTitleConfig({ enabled: false });
		expect(loadSessionTitleConfig()).toEqual({ enabled: false });
	});
});
