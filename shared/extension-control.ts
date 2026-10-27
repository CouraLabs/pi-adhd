import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { DEFAULT_EXTENSION_NAMES, EXTENSION_CATALOG, extensionNameList, resolveExtensionName } from "./extension-catalog.ts";
import { FEATURE_TOGGLES, featureToggleIdList, resolveFeatureToggle } from "./feature-toggles.ts";
import type { ExtensionName } from "./extension-registry.ts";
import { showExtensionToggle, toggleViaSelect } from "./extension-toggle.ts";
import { loadSettings, updateSettings } from "./settings.ts";

export function loadEnabledExtensions(): Set<ExtensionName> {
	const stored: unknown = loadSettings().extensions;

	const entries = Array.isArray(stored) ? stored : DEFAULT_EXTENSION_NAMES;
	const enabled = new Set<ExtensionName>();
	for (const raw of entries) {
		if (typeof raw !== "string") continue;
		const name = resolveExtensionName(raw);
		if (name) enabled.add(name);
	}
	return enabled;
}

export function isExtensionEnabled(name: ExtensionName): boolean {
	return loadEnabledExtensions().has(name);
}

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
	const extensionItems = EXTENSION_CATALOG.filter((entry) => entry.name.startsWith(needle)).map((entry) => ({
		value: entry.name,
		label: entry.name,
		description: `${enabled.has(entry.name) ? "enabled" : "disabled"} · ${entry.description}`,
	}));
	const featureItems = FEATURE_TOGGLES.filter((entry) => entry.id.startsWith(needle)).map((entry) => ({
		value: entry.id,
		label: entry.label,
		description: `${entry.isEnabled() ? "enabled" : "disabled"} · ${entry.description}`,
	}));
	return [...extensionItems, ...featureItems];
}

function registerToggleCommand(pi: ExtensionAPI): void {
	pi.registerCommand("couralabs:toggle", {
		description: "Toggle pi-adhd extensions and features (opens a list; usage: /couralabs:toggle [name])",
		getArgumentCompletions: (prefix) => completions(prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const input = args.trim();

			if (input) {
				const name = resolveExtensionName(input);
				if (name) {
					await applyAndReload(ctx, name, !isExtensionEnabled(name));
					return;
				}
				const feature = resolveFeatureToggle(input);
				if (feature) {
					const enabled = !feature.isEnabled();
					feature.setEnabled(enabled);
					emit(ctx, `pi-adhd ${feature.label} ${enabled ? "enabled" : "disabled"} — reloading extensions…`);

					await ctx.reload();
					return;
				}
				emit(
					ctx,
					`Unknown extension or toggle "${input}". Available: ${extensionNameList()}, ${featureToggleIdList()}`,
					"warning",
				);
				return;
			}

			const deps = {
				initialEnabled: loadEnabledExtensions(),
				setEnabled: setExtensionEnabled,
				features: FEATURE_TOGGLES.map((entry) => ({
					id: entry.id,
					label: entry.label,
					description: entry.description,
					enabled: entry.isEnabled(),
				})),
				setFeature: (id: string, enabled: boolean): void => {
					const feature = resolveFeatureToggle(id);
					feature?.setEnabled(enabled);
				},
			};

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

			emit(ctx, `Usage: /couralabs:toggle <extension|toggle>. Available: ${extensionNameList()}, ${featureToggleIdList()}`, "info");
		},
	});
}

function emit(ctx: ExtensionCommandContext, text: string, severity: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(text, severity);
		return;
	}
	console.error(text);
}

async function applyAndReload(ctx: ExtensionCommandContext, name: ExtensionName, enabled: boolean): Promise<void> {
	setExtensionEnabled(name, enabled);
	emit(ctx, `pi-adhd ${name} ${enabled ? "enabled" : "disabled"} — reloading extensions…`);
	await ctx.reload();
}

async function reloadAfterToggle(ctx: ExtensionCommandContext): Promise<void> {
	emit(ctx, "pi-adhd extensions updated — reloading…");
	await ctx.reload();
}

export function registerExtensionControlCommands(pi: ExtensionAPI): void {
	registerToggleCommand(pi);
}
