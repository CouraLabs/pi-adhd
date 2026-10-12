/**
 * tui-mode — read Pi's TUI render mode before mounting a pane.
 *
 * Pi decides overlay versus docked before it runs a `ui.custom` factory and
 * exposes no mode accessor, so the probe mounts a factory that closes with
 * `tui.mode` before returning; Pi then never mounts what it returns. A UI that
 * runs no factory (print or RPC mode) resolves `undefined`, which keeps the
 * docked default.
 *
 * Both `ExtensionUIContext` and the session navigator's narrow UI expose
 * `custom`, so this module types only that surface.
 */

import type { Component, TUI, TuiMode } from "@earendil-works/pi-tui";

/** What the mode probe mounts: nothing, since it closes before Pi would mount it. */
const NOTHING: Component = { render: () => [], invalidate: () => {} };

/** The `ui` surface the mode probe needs: only `custom`. */
export interface TuiModeProbeUI {
	custom<T>(
		factory: (tui: TUI, theme: unknown, keybindings: unknown, done: (result: T) => void) => Component,
	): Promise<T>;
}

/** Read the TUI render mode without mounting a visible component. */
export async function probeTuiMode(ui: TuiModeProbeUI): Promise<TuiMode> {
	const mode = await ui.custom<TuiMode | undefined>((tui, _theme, _keys, done) => {
		done(tui.mode);
		return NOTHING;
	});
	return mode === "fullscreen" ? "fullscreen" : "regular";
}
