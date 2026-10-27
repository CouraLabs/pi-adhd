import { agentDirState } from "../helpers/agent-dir.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXTENSION_CATALOG } from "../../shared/extension-catalog.ts";
import { DEFAULT_SETTINGS, getSettingsPath, loadSettings, saveSettings, updateSettings } from "../../shared/settings.ts";
import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

const settingsPath = (): string => join(dirname(agentDirState.dir), "couralabs", "settings.json");

let root = "";

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(root, "agent");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
	rmSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true, force: true });
	mkdirSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true });
});

describe("DEFAULT_SETTINGS", () => {
	it("lists every catalog extension name", () => {
		expect(DEFAULT_SETTINGS.extensions).toEqual(EXTENSION_CATALOG.map((entry) => entry.name));
	});

	it("uses pomodoro defaults 25/5/15/4", () => {
		expect(DEFAULT_SETTINGS.pomodoro).toEqual({
			workMinutes: 25,
			breakMinutes: 5,
			longBreakMinutes: 15,
			rounds: 4,
		});
	});

	it("defaults thinking preview lines to 5", () => {
		expect(DEFAULT_SETTINGS.thinking.previewLines).toBe(5);
	});

	it("uses spawn defaults", () => {
		expect(DEFAULT_SETTINGS.spawn).toEqual({
			defaultMaxTurns: 0,
			wrapUpTurns: 2,
			consumedSessionRetentionMinutes: 10,
			unconsumedSessionRetentionMinutes: 720,
			excludedExtensionPackages: [],
			promptInheritance: {},
			agentModels: {},
			agentThinking: {},
		});
	});

	it("defaults both web providers to auto", () => {
		expect(DEFAULT_SETTINGS.web.fetch.provider).toBe("auto");
		expect(DEFAULT_SETTINGS.web.search.provider).toBe("auto");
	});
});

describe("getSettingsPath", () => {
	it("points inside the mocked agent dir's parent", () => {
		expect(getSettingsPath()).toBe(join(dirname(agentDirState.dir), "couralabs", "settings.json"));
	});
});

describe("loadSettings", () => {
	it("creates the settings file with defaults when missing", () => {
		expect(existsSync(settingsPath())).toBe(false);
		const settings = loadSettings();
		expect(settings).toEqual(DEFAULT_SETTINGS);
		expect(existsSync(settingsPath())).toBe(true);
		expect(JSON.parse(readFileSync(settingsPath(), "utf8"))).toEqual(DEFAULT_SETTINGS);
	});

	it("deep-merges stored partial settings over defaults", () => {
		writeFileSync(
			settingsPath(),
			JSON.stringify({ thinking: { previewLines: 2 }, editor: { toolVerbs: { read: "Skimming" } } }),
			"utf8",
		);
		const settings = loadSettings();
		expect(settings.thinking.previewLines).toBe(2);
		expect(settings.thinking.useSummaryTitlesAsThinkingTitle).toBe(true);
		expect(settings.thinking.animationIntervalMs).toBe(90);
		expect(settings.editor.toolVerbs.read).toBe("Skimming");
		expect(settings.editor.toolVerbs.write).toBe("Writing");
		expect(settings.editor.fullCwd).toBe(false);
		expect(settings.pomodoro).toEqual(DEFAULT_SETTINGS.pomodoro);
	});

	it("returns defaults for corrupt JSON", () => {
		writeFileSync(settingsPath(), "{not json", "utf8");
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});

	it("returns defaults for non-object JSON", () => {
		writeFileSync(settingsPath(), "[]", "utf8");
		expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
	});
});

describe("updateSettings", () => {
	it("deep-merges a patch and persists it", () => {
		const next = updateSettings({ pomodoro: { workMinutes: 30 }, web: { fetch: { provider: "jina" } } });
		expect(next.pomodoro.workMinutes).toBe(30);
		expect(next.pomodoro.breakMinutes).toBe(5);
		expect(next.web.fetch.provider).toBe("jina");
		expect(next.web.fetch.nineRouterModel).toBe("exa");
		expect(next.web.search).toEqual(DEFAULT_SETTINGS.web.search);

		const reloaded = loadSettings();
		expect(reloaded.pomodoro.workMinutes).toBe(30);
		expect(reloaded.web.fetch.provider).toBe("jina");
		expect(reloaded.web.search.provider).toBe("auto");
	});
});

describe("saveSettings", () => {
	it("writes pretty JSON with a trailing newline via tmp+rename", () => {
		saveSettings(DEFAULT_SETTINGS);
		const content = readFileSync(settingsPath(), "utf8");
		expect(content.endsWith("\n")).toBe(true);
		expect(JSON.parse(content)).toEqual(DEFAULT_SETTINGS);
		expect(content).toContain('\n  "extensions"');
		expect(existsSync(`${settingsPath()}.tmp`)).toBe(false);
	});
});
