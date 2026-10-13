/**
 * extension-control — enable or disable pi-adhd extensions at runtime.
 *
 * The barrel (`extensions/index.ts`) reads the top-level `extensions` array in
 * `~/.pi/couralabs/settings.json` and calls only the listed factories. This
 * module owns that contract: it resolves the stored names (accepting aliases),
 * writes the array when a command changes it, and registers the
 * `/couralabs:enable` and `/couralabs:disable` commands. Both commands reload
 * the extension set so the change takes effect without restarting pi.
 *
 * The commands are registered by the barrel itself, before any optional
 * factory, so they remain available no matter which extensions are enabled.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { DEFAULT_EXTENSION_NAMES, EXTENSION_CATALOG, extensionNameList, resolveExtensionName } from "./extension-catalog.ts";
import type { ExtensionName } from "./extension-registry.ts";
import { loadSettings, updateSettings } from "./settings.ts";

/** The extensions the settings file currently enables, resolved to canonical names. */
export function loadEnabledExtensions(): Set<ExtensionName> {
	const stored: unknown = loadSettings().extensions;
	// A hand-edited file can replace the array with garbage; fall back to the
	// full set rather than disabling everything by accident.
	const entries = Array.isArray(stored) ? stored : DEFAULT_EXTENSION_NAMES;
	const enabled = new Set<ExtensionName>();
	for (const raw of entries) {
		if (typeof raw !== "string") continue;
		const name = resolveExtensionName(raw);
		if (name) enabled.add(name);
	}
	return enabled;
}

/** Whether the named extension is in the stored `extensions` array. */
export function isExtensionEnabled(name: ExtensionName): boolean {
	return loadEnabledExtensions().has(name);
}

/**
 * Add or remove an extension from the stored `extensions` array and persist it.
 * The array is rewritten in catalog order with canonical names, so aliases and
 * hand-edited ordering normalize on the first write.
 */
export function setExtensionEnabled(name: ExtensionName, enabled: boolean): void {
	const current = loadEnabledExtensions();
	if (enabled) current.add(name);
	else current.delete(name);
	const next = EXTENSION_CATALOG.filter((entry) => current.has(entry.name)).map((entry) => entry.name);
	updateSettings({ extensions: next });
}

function completions(prefix: string): AutocompleteItem[] {
	const needle = prefix.trim().toLowerCase();
	return EXTENSION_CATALOG.filter((entry) => entry.name.startsWith(needle)).map((entry) => ({
		value: entry.name,
		label: entry.name,
		description: entry.description,
	}));
}

function registerToggle(pi: ExtensionAPI, verb: "enable" | "disable", enable: boolean): void {
	pi.registerCommand(`couralabs:${verb}`, {
		description: `${enable ? "Enable" : "Disable"} a pi-adhd extension (usage: /couralabs:${verb} <extension>)`,
		getArgumentCompletions: (prefix) => completions(prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const input = args.trim();
			if (!input) {
				ctx.ui.notify(`Usage: /couralabs:${verb} <extension>. Available: ${extensionNameList()}`, "info");
				return;
			}

			const name = resolveExtensionName(input);
			if (!name) {
				ctx.ui.notify(`Unknown extension "${input}". Available: ${extensionNameList()}`, "warning");
				return;
			}

			if (isExtensionEnabled(name) === enable) {
				ctx.ui.notify(`pi-adhd ${name} is already ${enable ? "enabled" : "disabled"}.`, "info");
				return;
			}

			setExtensionEnabled(name, enable);
			ctx.ui.notify(
				`pi-adhd ${name} ${enable ? "enabled" : "disabled"} — reloading extensions…`,
				"info",
			);
			await ctx.reload();
		},
	});
}

/** Register `/couralabs:enable` and `/couralabs:disable`. */
export function registerExtensionControlCommands(pi: ExtensionAPI): void {
	registerToggle(pi, "enable", true);
	registerToggle(pi, "disable", false);
}
