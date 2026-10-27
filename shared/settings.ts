import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_EXTENSION_NAMES } from "./extension-catalog.ts";

export const DEFAULT_TOOL_VERBS: Readonly<Record<string, string>> = {
	read: "Reading",
	write: "Writing",
	edit: "Editing",
	bash: "Running",
};

export type PromptInheritance = "full" | "portable";

export interface EditorConfig {

	fullCwd: boolean;

	toolVerbs: Record<string, string>;
}

export interface SpawnConfig {

	defaultMaxTurns: number;

	wrapUpTurns: number;

	consumedSessionRetentionMinutes: number;

	unconsumedSessionRetentionMinutes: number;

	excludedExtensionPackages: string[];

	promptInheritance: Record<string, PromptInheritance>;

	agentModels: Record<string, string>;

	agentThinking: Record<string, string>;
}

export interface ThinkingConfig {

	useSummaryTitlesAsThinkingTitle: boolean;

	previewLines: number;

	animationIntervalMs: number;
}

export interface SessionTitleConfig {

	enabled: boolean;

	model?: string;
}

export interface TimerConfig {

	osNotification: boolean;
}

export interface PomodoroConfig {

	workMinutes: number;

	breakMinutes: number;

	longBreakMinutes: number;

	rounds: number;
}

export interface WebProviderConfig {

	provider: string;

	nineRouterModel: string;
}

export interface WebConfigSection {
	fetch: WebProviderConfig;
	search: WebProviderConfig;
}

export interface ClaudeLimitHandoffConfig {

	model?: string;
}

export interface CouralabsSettings {

	extensions: string[];
	editor: EditorConfig;
	thinking: ThinkingConfig;
	spawn: SpawnConfig;
	timer: TimerConfig;
	pomodoro: PomodoroConfig;
	sessionTitle: SessionTitleConfig;
	web: WebConfigSection;
	claudeLimitHandoff: ClaudeLimitHandoffConfig;
}

export interface SettingsPatch {
	extensions?: string[];
	editor?: { fullCwd?: boolean; toolVerbs?: Record<string, string> };
	thinking?: Partial<ThinkingConfig>;
	spawn?: Partial<SpawnConfig>;
	timer?: Partial<TimerConfig>;
	pomodoro?: Partial<PomodoroConfig>;
	sessionTitle?: Partial<SessionTitleConfig>;
	claudeLimitHandoff?: Partial<ClaudeLimitHandoffConfig>;
	web?: {
		fetch?: Partial<WebProviderConfig>;
		search?: Partial<WebProviderConfig>;
	};
}

export const DEFAULT_SETTINGS: CouralabsSettings = {
	extensions: [...DEFAULT_EXTENSION_NAMES],
	editor: {
		fullCwd: false,
		toolVerbs: { ...DEFAULT_TOOL_VERBS },
	},
	thinking: {
		useSummaryTitlesAsThinkingTitle: true,
		previewLines: 5,
		animationIntervalMs: 90,
	},
	spawn: {
		defaultMaxTurns: 0,
		wrapUpTurns: 2,
		consumedSessionRetentionMinutes: 10,
		unconsumedSessionRetentionMinutes: 720,
		excludedExtensionPackages: [],
		promptInheritance: {},
		agentModels: {},
		agentThinking: {},
	},
	timer: {
		osNotification: true,
	},
	pomodoro: {
		workMinutes: 25,
		breakMinutes: 5,
		longBreakMinutes: 15,
		rounds: 4,
	},
	sessionTitle: {
		enabled: true,
	},
	web: {
		fetch: { provider: "auto", nineRouterModel: "exa" },
		search: { provider: "auto", nineRouterModel: "exa" },
	},
	claudeLimitHandoff: {},
};

export function getSettingsPath(): string {
	return join(dirname(getAgentDir()), "couralabs", "settings.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = out[key];
		out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
	}
	return out;
}

interface RawSettingsFile {

	existed: boolean;

	raw: Record<string, unknown>;

	usable: boolean;
}

function readSettingsFile(): RawSettingsFile {
	const path = getSettingsPath();
	if (!existsSync(path)) return { existed: false, raw: {}, usable: true };
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isPlainObject(parsed)) return { existed: true, raw: {}, usable: false };
		return { existed: true, raw: parsed, usable: true };
	} catch {
		return { existed: true, raw: {}, usable: false };
	}
}

function coerce(raw: Record<string, unknown>): CouralabsSettings {

	const merged = merge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, raw);

	return merged as unknown as CouralabsSettings;
}

export function loadSettings(): CouralabsSettings {
	const { existed, raw } = readSettingsFile();
	const settings = coerce(raw);
	if (!existed) saveSettings(settings);
	return settings;
}

export function saveSettings(settings: CouralabsSettings): void {
	const path = getSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

export function updateSettings(patch: SettingsPatch): CouralabsSettings {
	const current = loadSettings();

	const next = coerce(merge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>));
	saveSettings(next);
	return next;
}
