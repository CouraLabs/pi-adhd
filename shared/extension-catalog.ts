import type { ExtensionName } from "./extension-registry.ts";

export interface ExtensionCatalogEntry {

	readonly name: ExtensionName;

	readonly description: string;

	readonly aliases?: readonly string[];
}

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
	{ name: "session-dashboard", description: "browser session dashboard served by a background process" },
	{ name: "spawn", description: "spawn tool and sub-agents" },
	{ name: "timer", description: "/timer bell countdown" },
	{ name: "web", description: "web fetch and search tools" },
	{ name: "claude", description: "Claude Agent SDK provider and Claude mode" },
];

export const DEFAULT_EXTENSION_NAMES: readonly ExtensionName[] = EXTENSION_CATALOG.map((entry) => entry.name);

type UncatalogedName = Exclude<ExtensionName, (typeof EXTENSION_CATALOG)[number]["name"]>;
type Assert<T extends true> = T;
type CatalogCoversRegistry = [UncatalogedName] extends [never] ? true : false;

export const CATALOG_COVERS_REGISTRY: Assert<CatalogCoversRegistry> = true;

const BY_INPUT = new Map<string, ExtensionName>();
for (const entry of EXTENSION_CATALOG) {
	BY_INPUT.set(entry.name.toLowerCase(), entry.name);
	for (const alias of entry.aliases ?? []) {
		BY_INPUT.set(alias.toLowerCase(), entry.name);
	}
}

export function resolveExtensionName(input: string): ExtensionName | undefined {
	return BY_INPUT.get(input.trim().toLowerCase());
}

export function extensionNameList(): string {
	return EXTENSION_CATALOG.map((entry) => entry.name).join(", ");
}
