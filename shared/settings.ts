/**
 * settings — persistent configuration shared by every pi-adhd extension.
 *
 * All pi-adhd ("couralabs") configuration lives in a single JSON file,
 * organized as `{ feature: { option: value } }` plus a top-level `extensions`
 * array naming which extensions the barrel loads:
 *
 *   ~/.pi/couralabs/settings.json
 *
 * The file is created with the defaults on first load. Extensions read the
 * current values at session start and write them back when a command changes
 * them. Unknown keys are preserved so a newer version of pi-adhd (or a hand
 * edit) never loses data.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_EXTENSION_NAMES } from "./extension-catalog.ts";

/** Prompt-inheritance strategy a child session adopts for a provider. */
export type PromptInheritance = "full" | "portable";

/** Configuration for the `editor` extension: the pi-adhd prompt field. */
export interface EditorConfig {
	/** When true the footer shows the full working directory; otherwise only its last folder. */
	fullCwd: boolean;
	/** When true the working indicator shows a random loading phrase; otherwise plain "Working...". */
	loadingPhrases: boolean;
}

/**
 * Operational configuration for the `spawn` extension. It lives under the
 * `spawn` key of the pi-adhd settings file, so every pi-adhd knob is in one
 * place.
 */
export interface SpawnConfig {
	/** Default turn ceiling for agents that declare none. 0 = unlimited. */
	defaultMaxTurns: number;
	/** Turns left when an agent is warned to wrap up. */
	wrapUpTurns: number;
	/** Minutes a consumed agent's session is retained. */
	consumedSessionRetentionMinutes: number;
	/** Minutes an unconsumed agent's session is retained (safety cap). */
	unconsumedSessionRetentionMinutes: number;
	/** Pi package sources whose extensions child sessions must not load. */
	excludedExtensionPackages: string[];
	/** Prompt-inheritance strategy per provider id; unlisted providers use "full". */
	promptInheritance: Record<string, PromptInheritance>;
	/** Model override per built-in agent name; written by `/spawn:model`. */
	agentModels: Record<string, string>;
	/** Thinking-level override per built-in agent name; written by `/spawn:model`. */
	agentThinking: Record<string, string>;
}

/** Configuration for the `thinking` extension's compact reasoning preview. */
export interface ThinkingConfig {
	/** For OpenAI models, use the latest reasoning-summary heading as the live title. */
	useSummaryTitlesAsThinkingTitle: boolean;
	/** Rendered reasoning-preview lines kept while thinking is hidden; 0 hides the preview. */
	previewLines: number;
	/** Milliseconds between animation frames while the model is reasoning. */
	animationIntervalMs: number;
}

/** Configuration for the `timer` extension's `/timer` command. */
export interface TimerConfig {
	/** Push a native OS notification when a timer fires, in addition to the terminal bell. */
	osNotification: boolean;
}

/** Configuration for the `pomodoro` extension's `/pomodoro` command. */
export interface PomodoroConfig {
	/** Length of a work session, in minutes. */
	workMinutes: number;
	/** Length of a short break, in minutes. */
	breakMinutes: number;
	/** Length of the long break after the last work session, in minutes. */
	longBreakMinutes: number;
	/** Work sessions before the long break. */
	rounds: number;
}

/** Provider selection for one `web` service (fetch or search). */
export interface WebProviderConfig {
	/** Provider id, or "auto" to try every configured provider in order. */
	provider: string;
	/** Model the 9Router aggregator fetches/searches with. */
	nineRouterModel: string;
}

/** Configuration for the `web` extension's fetch and search providers. */
export interface WebConfigSection {
	fetch: WebProviderConfig;
	search: WebProviderConfig;
}

/** Persisted pi-adhd configuration. */
export interface CouralabsSettings {
	/** Canonical names of the extensions to load; anything absent is not loaded. */
	extensions: string[];
	editor: EditorConfig;
	thinking: ThinkingConfig;
	spawn: SpawnConfig;
	timer: TimerConfig;
	pomodoro: PomodoroConfig;
	web: WebConfigSection;
}

/** A partial update; each provided leaf overrides the stored value. */
export interface SettingsPatch {
	extensions?: string[];
	editor?: { fullCwd?: boolean; loadingPhrases?: boolean };
	thinking?: Partial<ThinkingConfig>;
	spawn?: Partial<SpawnConfig>;
	timer?: Partial<TimerConfig>;
	pomodoro?: Partial<PomodoroConfig>;
	web?: {
		fetch?: Partial<WebProviderConfig>;
		search?: Partial<WebProviderConfig>;
	};
}

export const DEFAULT_SETTINGS: CouralabsSettings = {
	extensions: [...DEFAULT_EXTENSION_NAMES],
	editor: { fullCwd: false, loadingPhrases: true },
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
	web: {
		fetch: { provider: "auto", nineRouterModel: "exa" },
		search: { provider: "auto", nineRouterModel: "exa" },
	},
};

/** Path of the pi-adhd settings file (`~/.pi/couralabs/settings.json`). */
export function getSettingsPath(): string {
	return join(dirname(getAgentDir()), "couralabs", "settings.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep merge `override` onto `base`, returning a new object. Arrays and
 *  primitives replace; plain objects merge recursively. */
function merge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const current = out[key];
		out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
	}
	return out;
}

/** Result of reading the settings file from disk. */
interface RawSettingsFile {
	/** Whether the file existed (false means first run). */
	existed: boolean;
	/** Parsed top-level object; `{}` when missing or unusable. */
	raw: Record<string, unknown>;
	/** Whether the bytes on disk were parsed into a usable object. */
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
	// SAFETY: CouralabsSettings is a plain nested object, so its runtime shape is
	// a string-keyed map; merge only walks own enumerable properties.
	const merged = merge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, raw);
	// SAFETY: `merged` starts from DEFAULT_SETTINGS and only overlays stored
	// values, so every required key is present — the merge cannot drop one.
	return merged as unknown as CouralabsSettings;
}

/** Read the settings file, filling in defaults for anything missing. Creates
 *  the file with the defaults on first load. A file that exists but cannot be
 *  parsed is never overwritten — the user's bytes stay on disk for hand
 *  recovery while this session runs on defaults — so one transient corruption
 *  event cannot silently reset every setting. */
export function loadSettings(): CouralabsSettings {
	const { existed, raw } = readSettingsFile();
	const settings = coerce(raw);
	if (!existed) saveSettings(settings);
	return settings;
}

/** Write the full settings object to disk, creating the directory if needed.
 *  The write goes to a sibling temp file that is then renamed over the target,
 *  so a crash mid-write cannot leave a truncated settings.json behind. */
export function saveSettings(settings: CouralabsSettings): void {
	const path = getSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
}

/** Merge a patch into the stored settings and persist the result. */
export function updateSettings(patch: SettingsPatch): CouralabsSettings {
	const current = loadSettings();
	// SAFETY: both settings and patch are plain nested objects; merge treats them
	// as string-keyed maps and preserves every key it does not override.
	const next = coerce(merge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>));
	saveSettings(next);
	return next;
}
