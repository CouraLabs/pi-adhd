import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SettingsManager, loadSettings, persistToastFor, saveSettings } from "../../extensions/tools/spawn/settings.ts";
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

describe("loadSettings", () => {
	it("returns sanitized spawn defaults when nothing is stored", () => {
		expect(loadSettings()).toEqual({
			defaultMaxTurns: 0,
			wrapUpTurns: 2,
			consumedSessionRetentionMinutes: 10,
			unconsumedSessionRetentionMinutes: 720,
			excludedExtensionPackages: [],
		});
	});

	it("keeps valid stored values and drops invalid ones", () => {
		saveSettings({
			defaultMaxTurns: 5,
			wrapUpTurns: 3,
			consumedSessionRetentionMinutes: 20,
			unconsumedSessionRetentionMinutes: 60,
			excludedExtensionPackages: [" foo ", "", "bar", "foo"],
			promptInheritance: { openai: "portable", bad: "nope" as never },
		});
		expect(loadSettings()).toEqual({
			defaultMaxTurns: 5,
			wrapUpTurns: 3,
			consumedSessionRetentionMinutes: 20,
			unconsumedSessionRetentionMinutes: 60,
			excludedExtensionPackages: ["foo", "bar"],
			promptInheritance: { openai: "portable" },
		});
	});
});

describe("saveSettings", () => {
	it("persists a snapshot that survives a reload", () => {
		const persisted = saveSettings({
			defaultMaxTurns: 8,
			wrapUpTurns: 4,
			consumedSessionRetentionMinutes: 15,
			unconsumedSessionRetentionMinutes: 90,
		});
		expect(persisted).toBe(true);
		expect(loadSettings()).toMatchObject({
			defaultMaxTurns: 8,
			wrapUpTurns: 4,
			consumedSessionRetentionMinutes: 15,
			unconsumedSessionRetentionMinutes: 90,
		});
	});
});

describe("SettingsManager", () => {
	it("loads stored settings and clamps defaults", () => {
		saveSettings({ defaultMaxTurns: 6, wrapUpTurns: 3 });
		const manager = new SettingsManager({ emit: () => {} });
		manager.load();
		expect(manager.defaultMaxTurns).toBe(6);
		expect(manager.wrapUpTurns).toBe(3);
		expect(manager.consumedSessionRetentionMinutes).toBe(10);
	});

	it("clamps defaultMaxTurns below the minimum on apply", () => {
		const manager = new SettingsManager({ emit: () => {} });
		const result = manager.applyDefaultMaxTurns(1);
		expect(result).toEqual({ message: "Default max turns set to 2", level: "info" });
		expect(loadSettings().defaultMaxTurns).toBe(2);
	});

	it("treats 0 as unlimited and persists it", () => {
		saveSettings({ defaultMaxTurns: 5, wrapUpTurns: 2 });
		const manager = new SettingsManager({ emit: () => {} });
		manager.load();
		const result = manager.applyDefaultMaxTurns(0);
		expect(result.message).toBe("Default max turns set to unlimited");
		expect(loadSettings().defaultMaxTurns).toBe(0);
		expect(manager.snapshot().defaultMaxTurns).toBe(0);
	});

	it("clamps retention minutes to at least 1", () => {
		const manager = new SettingsManager({ emit: () => {} });
		manager.applyConsumedSessionRetentionMinutes(0);
		manager.applyUnconsumedSessionRetentionMinutes(5);
		const stored = loadSettings();
		expect(stored.consumedSessionRetentionMinutes).toBe(1);
		expect(stored.unconsumedSessionRetentionMinutes).toBe(5);
	});

	it("emits settings events on change and load", () => {
		const events: Array<[string, unknown]> = [];
		const manager = new SettingsManager({ emit: (event, payload) => events.push([event, payload]) });
		manager.load();
		manager.applyWrapUpTurns(5);
		expect(events.map(([event]) => event)).toEqual(["spawn:settings_loaded", "spawn:settings_changed"]);
	});
});

describe("persistToastFor", () => {
	it("reports success when persisted", () => {
		expect(persistToastFor("done", true)).toEqual({ message: "done", level: "info" });
	});

	it("warns when persistence failed", () => {
		const result = persistToastFor("done", false);
		expect(result.level).toBe("warning");
		expect(result.message).toContain("failed to persist");
	});
});
