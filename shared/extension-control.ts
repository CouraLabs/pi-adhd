/**
 * extension-control — toggle pi-adhd extensions at runtime.
 *
 * The barrel (`extensions/index.ts`) reads the top-level `extensions` array in
 * `~/.pi/couralabs/settings.json` and calls only the listed factories. This
 * module owns that contract: it resolves the stored names (accepting aliases),
 * writes the array when a command changes it, and registers the
 * `/couralabs:toggle` command. The command flips one extension and reloads the
 * set so the change takes effect without restarting pi.
 *
 * The command is registered by the barrel itself, before any optional factory,
 * so it remains available no matter which extensions are enabled.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { DEFAULT_EXTENSION_NAMES, EXTENSION_CATALOG, extensionNameList, resolveExtensionName } from "./extension-catalog.ts";
import type { ExtensionName } from "./extension-registry.ts";
import { showExtensionToggle, toggleViaSelect } from "./extension-toggle.ts";
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
	const enabled = loadEnabledExtensions();
	return EXTENSION_CATALOG.filter((entry) => entry.name.startsWith(needle)).map((entry) => ({
		value: entry.name,
		label: entry.name,
		description: `${enabled.has(entry.name) ? "enabled" : "disabled"} · ${entry.description}`,
	}));
}

function registerToggleCommand(pi: ExtensionAPI): void {
	pi.registerCommand("couralabs:toggle", {
		description: "Toggle pi-adhd extensions (opens a list; usage: /couralabs:toggle [extension])",
		getArgumentCompletions: (prefix) => completions(prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const input = args.trim();

			// An explicit name toggles directly, in every mode, so the command still
			// works when there is no dialog to open.
			if (input) {
				const name = resolveExtensionName(input);
				if (!name) {
					emit(ctx, `Unknown extension "${input}". Available: ${extensionNameList()}`, "warning");
					return;
				}
				await applyAndReload(ctx, name, !isExtensionEnabled(name));
				return;
			}

			const deps = { initialEnabled: loadEnabledExtensions(), setEnabled: setExtensionEnabled };

			// The interactive list: TUI mounts the component, RPC drives the same
			// state through repeated selects. Changes are persisted as they happen
			// and the set is reloaded once, after the dialog closes — reloading mid-
			// dialog would replace the runtime and unmount the component.
			if (ctx.mode === "tui") {
				const changed = await showExtensionToggle(ctx.ui, deps);
				if (changed) await reloadAfterToggle(ctx);
				return;
			}
			if (ctx.hasUI) {
				const changed = await toggleViaSelect(ctx.ui, deps);
				if (changed) await reloadAfterToggle(ctx);
				return;
			}

			emit(ctx, `Usage: /couralabs:toggle <extension>. Available: ${extensionNameList()}`, "info");
		},
	});
}

/** Headless-safe output: notify in dialog-capable UIs, stderr text elsewhere. */
function emit(ctx: ExtensionCommandContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, severity);
		return;
	}
	console.error(text);
}

/** Persist one extension's state, announce it, and reload the set. */
async function applyAndReload(ctx: ExtensionCommandContext, name: ExtensionName, enabled: boolean): Promise<void> {
	setExtensionEnabled(name, enabled);
	emit(ctx, `pi-adhd ${name} ${enabled ? "enabled" : "disabled"} — reloading extensions…`);
	await ctx.reload();
}

/** Announce a dialog's changes and reload once. */
async function reloadAfterToggle(ctx: ExtensionCommandContext): Promise<void> {
	emit(ctx, "pi-adhd extensions updated — reloading…");
	await ctx.reload();
}

/** Register `/couralabs:toggle`. */
export function registerExtensionControlCommands(pi: ExtensionAPI): void {
	registerToggleCommand(pi);
}
