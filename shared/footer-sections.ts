/**
 * footer-sections — the process-global list of extra blocks the pi-tdah footer
 * draws after its own lines.
 *
 * The footer is the last component in pi's dock (below the editor and every
 * widget), so a block registered here is the last thing on screen. A section
 * publishes a render function rather than rendered lines: the footer owns the
 * width, the theme, the terminal mode, and the render trigger, and calls back
 * into the section on every frame.
 *
 * State lives on `globalThis` under a registered symbol (see `store.ts`) so
 * every extension instance shares one list even when modules load twice.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMode } from "@earendil-works/pi-tui";
import { createGlobalStore } from "./store.ts";

/** Everything a section needs to draw one frame. */
export interface FooterSectionContext {
	/** Full footer width in columns. */
	width: number;
	/** Terminal height in rows, for sections that bound their own line count. */
	height: number;
	/** The active renderer's mode. */
	mode: TuiMode;
	/** The footer's active theme. */
	theme: Theme;
	/** Ask pi to draw another frame — used by animated sections. */
	requestRender(): void;
}

/** A block of lines the footer draws after its stats line and statuses line. */
export interface FooterSection {
	/** Stable identity; registering an id that already exists replaces it. */
	id: string;
	/** Render the section's lines for the current frame. Return `[]` to draw nothing. */
	render(ctx: FooterSectionContext): string[];
}

const store = createGlobalStore<readonly FooterSection[]>(
	Symbol.for("@couralabs/pi-tdah/footer-sections"),
	[],
);

/** Register (or replace) a section; returns a function that unregisters it. */
export function registerFooterSection(section: FooterSection): () => void {
	store.set([...store.get().filter((s) => s.id !== section.id), section]);
	return () => {
		store.set(store.get().filter((s) => s.id !== section.id));
	};
}

/** The registered sections, in registration order. */
export function getFooterSections(): readonly FooterSection[] {
	return store.get();
}

/** Subscribe to section registration changes; returns an unsubscribe function. */
export function subscribeFooterSections(listener: () => void): () => void {
	return store.subscribe(() => listener());
}
