/**
 * settings — persistent configuration shared by every pi-pack extension.
 *
 * All pi-pack ("couralabs") configuration lives in a single JSON file,
 * organized as `{ feature: { option: value } }`:
 *
 *   ~/.pi/couralabs/settings.json
 *
 * The file is created with the defaults on first load. Extensions read the
 * current values at session start and write them back when a command changes
 * them. Unknown keys are preserved so a newer version of pi-pack (or a hand
 * edit) never loses data.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_AGENT_MODE, type AgentMode } from "./modes.ts";
import { DEFAULT_SUBMODE, type Submode } from "./submodes.ts";

/** Prompt-inheritance strategy a child session adopts for a provider. */
export type PromptInheritance = "full" | "portable";

/**
 * Operational configuration for the `subagents` extension. It lives under the
 * `subagents` key of the pi-pack settings file, next to its `enabled` toggle,
 * so every pi-pack knob is in one place.
 */
export interface SubagentsConfig {
	/** Master switch: when false the tools are hidden and the widget cleared. */
	enabled: boolean;
	/** Maximum number of background agents running at once; the rest queue. */
	maxConcurrent: number;
	/** Default turn ceiling for agents that declare none. 0 = unlimited. */
	defaultMaxTurns: number;
	/** Turns left when an agent is warned to wrap up. */
	wrapUpTurns: number;
	/** Minutes a consumed agent's session is retained. */
	consumedSessionRetentionMinutes: number;
	/** Minutes an unconsumed agent's session is retained (safety cap). */
	unconsumedSessionRetentionMinutes: number;
	/** When false, a parent interrupt leaves background agents running. */
	abortAllOnInterrupt: boolean;
	/** When false, background children cannot interrupt the parent mid-run. */
	midRunUpdates: boolean;
	/** Pi package sources whose extensions child sessions must not load. */
	excludedExtensionPackages: string[];
	/** Prompt-inheritance strategy per provider id; unlisted providers use "full". */
	promptInheritance: Record<string, PromptInheritance>;
	/** Model override per built-in agent name; written by `/subagent-model`. */
	agentModels: Record<string, string>;
}

/** Configuration for the `thinking` extension's compact reasoning preview. */
export interface ThinkingConfig {
	/** Master switch: when false the compact renderer is not installed. */
	enabled: boolean;
	/** For OpenAI models, use the latest reasoning-summary heading as the live title. */
	useSummaryTitlesAsThinkingTitle: boolean;
	/** Rendered reasoning-preview lines kept while thinking is hidden; 0 hides the preview. */
	previewLines: number;
	/** Milliseconds between animation frames while the model is reasoning. */
	animationIntervalMs: number;
}

/** Configuration for the `modes` extension: the active Pi/Work agent mode. */
export interface ModesConfig {
	/** Mode restored at session start; switched at runtime with /mode. */
	current: AgentMode;
}

/** Configuration for the `submodes` extension: the active Plan/Grill submode. */
export interface SubmodesConfig {
	/** Submode restored at session start; set at runtime with `/submode`. */
	current: Submode;
}

/** Persisted pi-pack configuration. */
export interface CouralabsSettings {
	footer: { enabled: boolean };
	editor: { enabled: boolean };
	messages: { enabled: boolean };
	thinking: ThinkingConfig;
	subagents: SubagentsConfig;
	modes: ModesConfig;
	submodes: SubmodesConfig;
}

/** A partial update; each provided leaf overrides the stored value. */
export interface SettingsPatch {
	footer?: { enabled?: boolean };
	editor?: { enabled?: boolean };
	messages?: { enabled?: boolean };
	thinking?: Partial<ThinkingConfig>;
	subagents?: Partial<SubagentsConfig>;
	modes?: Partial<ModesConfig>;
	submodes?: Partial<SubmodesConfig>;
}

export const DEFAULT_SETTINGS: CouralabsSettings = {
	footer: { enabled: true },
	editor: { enabled: true },
	messages: { enabled: true },
	thinking: {
		enabled: true,
		useSummaryTitlesAsThinkingTitle: true,
		previewLines: 5,
		animationIntervalMs: 90,
	},
	subagents: {
		enabled: true,
		maxConcurrent: 4,
		defaultMaxTurns: 0,
		wrapUpTurns: 2,
		consumedSessionRetentionMinutes: 10,
		unconsumedSessionRetentionMinutes: 720,
		abortAllOnInterrupt: true,
		midRunUpdates: true,
		excludedExtensionPackages: [],
		promptInheritance: {},
		agentModels: {},
	},
	modes: {
		current: DEFAULT_AGENT_MODE,
	},
	submodes: {
		current: DEFAULT_SUBMODE,
	},
};

/** Path of the pi-pack settings file (`~/.pi/couralabs/settings.json`). */
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

function readRaw(): Record<string, unknown> {
	const path = getSettingsPath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return isPlainObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function coerce(raw: Record<string, unknown>): CouralabsSettings {
	const merged = merge(DEFAULT_SETTINGS as unknown as Record<string, unknown>, raw);
	return merged as unknown as CouralabsSettings;
}

/** Read the settings file, filling in defaults for anything missing. Creates
 *  the file with the defaults when it does not exist yet. */
export function loadSettings(): CouralabsSettings {
	const path = getSettingsPath();
	const existed = existsSync(path);
	const settings = coerce(readRaw());
	if (!existed) saveSettings(settings);
	return settings;
}

/** Write the full settings object to disk, creating the directory if needed. */
export function saveSettings(settings: CouralabsSettings): void {
	const path = getSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/** Merge a patch into the stored settings and persist the result. */
export function updateSettings(patch: SettingsPatch): CouralabsSettings {
	const current = loadSettings();
	const next = coerce(merge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>));
	saveSettings(next);
	return next;
}
