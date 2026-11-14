import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

export type SdkSettings = Exclude<NonNullable<Options["settings"]>, string>;

type SettingsObject = Record<string, unknown>;

export const PI_DEFAULT_SETTINGS: SdkSettings = {
	agentPushNotifEnabled: true,
	showMessageTimestamps: true,
	idleCompaction: false,
	autoCompactEnabled: true,
	showThinkingSummaries: true,
	autoMemoryEnabled: false,
	emojiCompletionEnabled: false,
	spinnerTipsEnabled: false,
	disableAgentView: true,
	allowAllClaudeAiMcps: false,
	includeGitInstructions: false,
	syncClaudeAiPlugins: false,
	syncClaudeAiSkills: false,
	enableAllProjectMcpServers: true,
	promptCacheTtl: "1h",
	subagentPromptCacheTtl: "1h",
	viewMode: "verbose",
	attribution: { commit: "", pr: "" },
};

function isSettingsObject(value: unknown): value is SettingsObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function concatUnique(base: readonly unknown[], overlay: readonly unknown[]): unknown[] {
	const seen = new Set(base.map((item) => JSON.stringify(item)));
	return [...base, ...overlay.filter((item) => !seen.has(JSON.stringify(item)))];
}

export function mergeSettings(base: SettingsObject, overlay: SettingsObject): SettingsObject {
	const merged: SettingsObject = { ...base };
	for (const [key, value] of Object.entries(overlay)) {
		const current = merged[key];
		if (Array.isArray(current) && Array.isArray(value)) merged[key] = concatUnique(current, value);
		else if (isSettingsObject(current) && isSettingsObject(value)) merged[key] = mergeSettings(current, value);
		else merged[key] = value;
	}
	return merged;
}

export function claudeUserSettingsPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
	return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

export function readClaudeUserSettings(path: string = claudeUserSettingsPath()): SettingsObject {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isSettingsObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function buildSdkSettings(userSettings: SettingsObject = readClaudeUserSettings()): SdkSettings {
	return mergeSettings(PI_DEFAULT_SETTINGS as SettingsObject, userSettings) as SdkSettings;
}
