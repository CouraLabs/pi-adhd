import type { Component, TUI, TuiMode } from "@earendil-works/pi-tui";

const NOTHING: Component = { render: () => [], invalidate: () => {} };

export interface TuiModeProbeUI {
	custom<T>(
		factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

export async function probeTuiMode(ui: TuiModeProbeUI): Promise<TuiMode> {
	const mode = await ui.custom<TuiMode | undefined>((tui, _theme, _keys, done) => {
		done(tui.mode);
		return NOTHING;
	});
	return mode === "fullscreen" ? "fullscreen" : "regular";
}
