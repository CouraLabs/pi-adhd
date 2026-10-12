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

/** Persisted pi-pack configuration. */
export interface CouralabsSettings {
	footer: { enabled: boolean };
	editor: { enabled: boolean };
	messages: { enabled: boolean };
}

/** A partial update; each provided leaf overrides the stored value. */
export interface SettingsPatch {
	footer?: { enabled?: boolean };
	editor?: { enabled?: boolean };
	messages?: { enabled?: boolean };
}

export const DEFAULT_SETTINGS: CouralabsSettings = {
	footer: { enabled: true },
	editor: { enabled: true },
	messages: { enabled: true },
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
