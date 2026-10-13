/**
 * extension-registry — which optional pi-tdah extensions are loaded.
 *
 * Every pi-tdah extension is individually loadable: a host may load one, a
 * few, or the whole package. When one extension reads state another owns —
 * goal mode consulting the persisted submode, for example — it must not act
 * on that state unless the owner is actually loaded, or a value persisted by
 * an earlier install would leak in. Each extension marks itself at factory
 * time; readers check before consuming another extension's state.
 *
 * The set lives on `globalThis` under a registered symbol so duplicate module
 * instances (jiti reloads, child sessions) share one registry. A name is only
 * ever added, never removed: a load is process-lifetime, and a child session's
 * copy must not erase the parent's entry.
 */

import { createGlobalStore } from "./store.ts";

/** Names of the pi-tdah extensions a consumer may check for. */
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
	Symbol.for("@couralabs/pi-tdah/loaded-extensions"),
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
