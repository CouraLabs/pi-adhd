import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	PI_DEFAULT_SETTINGS,
	buildSdkSettings,
	claudeUserSettingsPath,
	mergeSettings,
	readClaudeUserSettings,
} from "../../../extensions/providers/claude/claude-settings.ts";

describe("mergeSettings", () => {
	it("lets user values win, merges nested objects, and concatenates arrays without duplicates", () => {
		const merged = mergeSettings(
			{ viewMode: "verbose", attribution: { commit: "", pr: "" }, permissions: { allow: ["Read"] } },
			{ viewMode: "default", attribution: { pr: "by me" }, permissions: { allow: ["Read", "Bash(ls)"], deny: ["WebFetch"] } },
		);
		expect(merged).toEqual({
			viewMode: "default",
			attribution: { commit: "", pr: "by me" },
			permissions: { allow: ["Read", "Bash(ls)"], deny: ["WebFetch"] },
		});
	});
});

describe("buildSdkSettings", () => {
	it("keeps pi defaults for keys the user did not set", () => {
		const settings = buildSdkSettings({ outputStyle: "Proactive", spinnerTipsEnabled: true });
		expect(settings).toMatchObject({ ...PI_DEFAULT_SETTINGS, outputStyle: "Proactive", spinnerTipsEnabled: true });
	});

	it("does not mutate the defaults", () => {
		buildSdkSettings({ attribution: { commit: "x" } });
		expect(PI_DEFAULT_SETTINGS.attribution).toEqual({ commit: "", pr: "" });
	});
});

describe("readClaudeUserSettings", () => {
	it("reads settings.json from CLAUDE_CONFIG_DIR", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-settings-"));
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ outputStyle: "Proactive" }));
		const path = claudeUserSettingsPath({ CLAUDE_CONFIG_DIR: dir });
		expect(readClaudeUserSettings(path)).toEqual({ outputStyle: "Proactive" });
	});

	it("falls back to no user settings when the file is missing or invalid", () => {
		const dir = mkdtempSync(join(tmpdir(), "claude-settings-"));
		writeFileSync(join(dir, "settings.json"), "{ not json");
		expect(readClaudeUserSettings(join(dir, "settings.json"))).toEqual({});
		expect(readClaudeUserSettings(join(dir, "missing.json"))).toEqual({});
	});
});
