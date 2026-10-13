/**
 * extension-registry — which optional pi-adhd extensions are loaded.
 *
 * Every pi-adhd extension is individually loadable: a host may load one, a
 * few, or the whole package. When one extension reads state another owns —
 * goal mode consulting the persisted submode, for example — it must not act
 * on that state unless the owner is actually loaded, or a value persisted by
 * an earlier install would leak in. Each extension marks itself at factory
 * time; readers check before consuming another extension's state.
 *
 * The set lives on `globalThis` under a registered symbol so duplicate module
 * instances (jiti reloads, child sessions) share one registry. Names are added
 * by each factory as it loads; the barrel resets the set before it loads the
 * enabled extensions so a reload reflects the current settings rather than
 * names marked by a previous load.
 */

import { createGlobalStore } from "./store.ts";

/** Names of the pi-adhd extensions a consumer may check for. */
export type ExtensionName =
	| "ask-user"
	| "editor"
	| "footer"
	| "goal"
	| "messages"
	| "modes"
	| "spawn"
	| "submodes"
	| "thinking"
	| "todo"
	| "web";

const store = createGlobalStore<ReadonlySet<ExtensionName>>(
	Symbol.for("@couralabs/pi-adhd/loaded-extensions"),
	new Set<ExtensionName>(),
);

/** Mark an extension as loaded. Call at the top of its factory. Idempotent. */
export function markExtensionLoaded(name: ExtensionName): void {
	const current = store.get();
	if (current.has(name)) return;
	const next = new Set(current);
	next.add(name);
	store.set(next);
}

/** Whether the named extension is loaded in this process. */
export function isExtensionLoaded(name: ExtensionName): boolean {
	return store.get().has(name);
}

/**
 * Forget every marked extension. The barrel calls this before it loads the
 * enabled set so a `/reload` after `/couralabs:enable` or `/couralabs:disable`
 * does not keep reporting an extension that is no longer loaded.
 */
export function resetExtensionRegistry(): void {
	store.set(new Set<ExtensionName>());
}
