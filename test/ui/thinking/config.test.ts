import { agentDirState } from "../../helpers/agent-dir.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { refreshThinkingConfig, thinkingConfig } from "../../../extensions/ui/thinking/config.ts";
import { DEFAULT_SETTINGS, getSettingsPath, updateSettings } from "../../../shared/settings.ts";
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
	mkdirSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true });
});

afterEach(() => {
	rmSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true, force: true });
});

describe("refreshThinkingConfig", () => {
	it("returns the defaults when no settings are stored", () => {
		expect(refreshThinkingConfig()).toEqual(DEFAULT_SETTINGS.thinking);
	});

	it("picks up a persisted patch", () => {
		updateSettings({ thinking: { previewLines: 2, animationIntervalMs: 250 } });
		expect(refreshThinkingConfig()).toEqual({
			useSummaryTitlesAsThinkingTitle: true,
			previewLines: 2,
			animationIntervalMs: 250,
		});
	});

	it("normalizes invalid stored values back to defaults", () => {
		writeFileSync(
			getSettingsPath(),
			JSON.stringify({
				thinking: { useSummaryTitlesAsThinkingTitle: false, previewLines: -3, animationIntervalMs: 0 },
			}),
			"utf8",
		);
		expect(refreshThinkingConfig()).toEqual({
			useSummaryTitlesAsThinkingTitle: false,
			previewLines: DEFAULT_SETTINGS.thinking.previewLines,
			animationIntervalMs: DEFAULT_SETTINGS.thinking.animationIntervalMs,
		});
	});
});

describe("thinkingConfig", () => {
	it("serves the cache and stays stale until refreshed", () => {
		refreshThinkingConfig();
		updateSettings({ thinking: { previewLines: 7 } });
		expect(thinkingConfig().previewLines).toBe(DEFAULT_SETTINGS.thinking.previewLines);
		expect(refreshThinkingConfig().previewLines).toBe(7);
		expect(thinkingConfig().previewLines).toBe(7);
	});
});
