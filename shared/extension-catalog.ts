/**
 * extension-catalog — the pi-adhd extensions that can be enabled or disabled.
 *
 * `~/.pi/couralabs/settings.json` carries a top-level `extensions` array. The
 * barrel (`extensions/index.ts`) reads it and calls only the listed factories,
 * so an extension missing from the array is never loaded. This module is the
 * single list of what may appear there: the settings schema uses it for its
 * default, and the `/couralabs:toggle` command uses it
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
	{ name: "commands", description: "/cmd:<name> prompt commands from .agents + .claude" },
	{ name: "ask-user", aliases: ["askUser", "ask"], description: "ask_user tool" },
	{ name: "job", description: "background terminal jobs" },
	{ name: "pomodoro", description: "pomodoro work/break sessions" },
	{ name: "session-title", aliases: ["sessionTitle", "titles"], description: "automatic session titles from the last user prompt" },
	{ name: "spawn", description: "spawn tool and sub-agents" },
	{ name: "timer", description: "/timer bell countdown" },
	{ name: "web", description: "web fetch and search tools" },
	{ name: "claude", description: "Claude Agent SDK provider and Claude mode" },
];

/** Canonical names of every extension, used as the settings default. */
export const DEFAULT_EXTENSION_NAMES: readonly ExtensionName[] = EXTENSION_CATALOG.map((entry) => entry.name);

// Compile-time drift guard: the catalog must cover every `ExtensionName`. An
// extension added to the registry and barrel but not here would be silently
// untoggleable and excluded from the defaults; this turns that into a type
// error on the line below.
type UncatalogedName = Exclude<ExtensionName, (typeof EXTENSION_CATALOG)[number]["name"]>;
type Assert<T extends true> = T;
type CatalogCoversRegistry = [UncatalogedName] extends [never] ? true : false;
/** Compile-time proof that the catalog covers the registry; keep exported so the check is always evaluated. */
export const CATALOG_COVERS_REGISTRY: Assert<CatalogCoversRegistry> = true;

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
