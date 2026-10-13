/**
 * extension-catalog — the pi-adhd extensions that can be enabled or disabled.
 *
 * `~/.pi/couralabs/settings.json` carries a top-level `extensions` array. The
 * barrel (`extensions/index.ts`) reads it and calls only the listed factories,
 * so an extension missing from the array is never loaded. This module is the
 * single list of what may appear there: the settings schema uses it for its
 * default, and the `/couralabs:enable` and `/couralabs:disable` commands use it
 * to resolve what the operator typed.
 *
 * Names are the registry names (`shared/extension-registry.ts`), which match
 * the extension folders (`ask-user`, not `askUser`). Aliases exist so the
 * camel-case spelling is accepted on the command line and in a hand-edited
 * settings file, and normalized to the canonical name when written back.
 */

import type { ExtensionName } from "./extension-registry.ts";

/** One toggleable extension and how the operator may name it. */
export interface ExtensionCatalogEntry {
	/** Canonical name: the registry name and the value stored in settings. */
	readonly name: ExtensionName;
	/** One-line summary shown in command usage and notifications. */
	readonly description: string;
	/** Additional spellings accepted for `name` (case-insensitive). */
	readonly aliases?: readonly string[];
}

/** Every toggleable pi-adhd extension, in the barrel's load order. */
export const EXTENSION_CATALOG: readonly ExtensionCatalogEntry[] = [
	{ name: "editor", description: "pi-adhd prompt field" },
	{ name: "footer", description: "pi-adhd footer / stats line" },
	{ name: "messages", description: "pi-adhd tool-call message UI" },
	{ name: "thinking", description: "compact animated thinking preview" },
	{ name: "modes", description: "Pi/Work agent modes" },
	{ name: "submodes", description: "Plan/Grill/Straight submodes" },
	{ name: "ask-user", aliases: ["askUser", "ask"], description: "ask_user tool" },
	{ name: "goal", description: "persistent goal loop" },
	{ name: "spawn", description: "spawn tool and sub-agents" },
	{ name: "todo", description: "phased todo tool" },
	{ name: "web", description: "web fetch and search tools" },
];

/** Canonical names of every extension, used as the settings default. */
export const DEFAULT_EXTENSION_NAMES: readonly ExtensionName[] = EXTENSION_CATALOG.map((entry) => entry.name);

const BY_INPUT = new Map<string, ExtensionName>();
for (const entry of EXTENSION_CATALOG) {
	BY_INPUT.set(entry.name.toLowerCase(), entry.name);
	for (const alias of entry.aliases ?? []) {
		BY_INPUT.set(alias.toLowerCase(), entry.name);
	}
}

/** Resolve operator input (canonical name or alias) to a canonical name. */
export function resolveExtensionName(input: string): ExtensionName | undefined {
	return BY_INPUT.get(input.trim().toLowerCase());
}

/** Comma-separated canonical names, for usage and error messages. */
export function extensionNameList(): string {
	return EXTENSION_CATALOG.map((entry) => entry.name).join(", ");
}
