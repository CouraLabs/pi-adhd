import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMode } from "@earendil-works/pi-tui";
import { createGlobalStore } from "./store.ts";

export interface FooterSectionContext {

	width: number;

	height: number;

	mode: TuiMode;

	theme: Theme;

	requestRender(): void;
}

export interface FooterSection {

	id: string;

	render(ctx: FooterSectionContext): string[];
}

const store = createGlobalStore<readonly FooterSection[]>(
	Symbol.for("@couralabs/pi-adhd/footer-sections"),
	[],
);

export function registerFooterSection(section: FooterSection): () => void {
	store.set([...store.get().filter((s) => s.id !== section.id), section]);
	return () => {
		store.set(store.get().filter((s) => s !== section));
	};
}

export function getFooterSections(): readonly FooterSection[] {
	return store.get();
}

export function subscribeFooterSections(listener: () => void): () => void {
	return store.subscribe(() => listener());
}
