import { createGlobalStore } from "./store.ts";

export type ExtensionName =
	| "ask-user"
	| "claude"
	| "commands"
	| "editor"
	| "footer"
	| "job"
	| "messages"
	| "modes"
	| "pomodoro"
	| "session-dashboard"
	| "session-title"
	| "spawn"
	| "submodes"
	| "thinking"
	| "timer"
	| "web";

const store = createGlobalStore<ReadonlySet<ExtensionName>>(
	Symbol.for("@couralabs/pi-adhd/loaded-extensions"),
	new Set<ExtensionName>(),
);

export function markExtensionLoaded(name: ExtensionName): void {
	const current = store.get();
	if (current.has(name)) return;
	const next = new Set(current);
	next.add(name);
	store.set(next);
}

export function isExtensionLoaded(name: ExtensionName): boolean {
	return store.get().has(name);
}

export function resetExtensionRegistry(): void {
	store.set(new Set<ExtensionName>());
}
