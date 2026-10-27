import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayOptions, type TUI, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { EXTENSION_CATALOG } from "./extension-catalog.ts";
import { FEATURE_TOGGLES } from "./feature-toggles.ts";
import type { ExtensionName } from "./extension-registry.ts";
import { PROMPT } from "./glyphs.ts";
import { labeledRule } from "./labeled-rule.ts";
import { probeTuiMode } from "./tui-mode.ts";
import { clamp } from "./util.ts";

export interface ExtensionToggleDeps {

	initialEnabled: ReadonlySet<ExtensionName>;

	setEnabled: (name: ExtensionName, enabled: boolean) => void;

	features: readonly { id: string; label: string; description: string; enabled: boolean }[];

	setFeature: (id: string, enabled: boolean) => void;
}

interface Entry {

	kind: "extension" | "feature";

	name?: ExtensionName;

	featureId?: string;

	label: string;
	description: string;
	enabled: boolean;
}

function entryKey(entry: Entry): string {
	return entry.kind === "extension" ? `extension:${entry.name}` : `feature:${entry.featureId}`;
}

const DIALOG_TITLE = "pi-adhd extensions & toggles";
const HINTS = "↑↓ move · Enter toggle · Esc close";

const NAME_COLUMN =
	Math.max(
		...EXTENSION_CATALOG.map((entry) => entry.name.length),
		...FEATURE_TOGGLES.map((entry) => entry.label.length),
	) + 2;

interface PaneOptions {
	tui: TUI;
	theme: Theme;
	keys: KeybindingsManager;
	deps: ExtensionToggleDeps;
	fullscreen: boolean;
	done: (changed: boolean) => void;
}

export async function showExtensionToggle(ui: ExtensionUIContext, deps: ExtensionToggleDeps): Promise<boolean> {
	const mode = await probeTuiMode(ui);
	const fullscreen = mode === "fullscreen";
	const overlayOptions: OverlayOptions = { anchor: "center", width: "80%", maxHeight: "80%", margin: 1 };
	return ui.custom<boolean>(
		(tui, theme, keys, done) => new ExtensionTogglePane({ tui, theme, keys, deps, fullscreen, done }),
		fullscreen ? { overlay: true, overlayOptions } : { overlay: false },
	);
}

export async function toggleViaSelect(ui: ExtensionUIContext, deps: ExtensionToggleDeps): Promise<boolean> {
	const entries: Entry[] = [
		...EXTENSION_CATALOG.map(
			(entry): Entry => ({
				kind: "extension",
				name: entry.name,
				label: entry.name,
				description: entry.description,
				enabled: deps.initialEnabled.has(entry.name),
			}),
		),
		...deps.features.map(
			(feature): Entry => ({
				kind: "feature",
				featureId: feature.id,
				label: feature.label,
				description: feature.description,
				enabled: feature.enabled,
			}),
		),
	];

	let changed = false;

	const toggled = new Set<number>();
	for (;;) {
		const options = entries.map((entry) => `${entry.enabled ? "[x]" : "[ ]"} ${entry.label} — ${entry.description}`);
		options.push("Done");
		const choice = await ui.select(DIALOG_TITLE, options);
		if (!choice || choice === "Done") break;

		let index = options.indexOf(choice);
		while (index !== -1 && toggled.has(index)) {
			const next = options.indexOf(choice, index + 1);
			if (next === -1) break;
			index = next;
		}
		const entry = entries[index];
		if (!entry) continue;
		entry.enabled = !entry.enabled;
		applyEntry(deps, entry);
		toggled.add(index);
		changed = true;
	}
	return changed;
}

function applyEntry(deps: ExtensionToggleDeps, entry: Entry): void {
	if (entry.kind === "extension" && entry.name) deps.setEnabled(entry.name, entry.enabled);
	else if (entry.kind === "feature" && entry.featureId) deps.setFeature(entry.featureId, entry.enabled);
}

export class ExtensionTogglePane implements Component {
	#focused = false;
	get focused(): boolean {
		return this.#focused;
	}
	set focused(value: boolean) {
		this.#focused = value;
	}

	readonly #tui: TUI;
	readonly #theme: Theme;
	readonly #keys: KeybindingsManager;
	readonly #fullscreen: boolean;
	readonly #done: (changed: boolean) => void;
	readonly #deps: ExtensionToggleDeps;
	readonly #entries: Entry[];
	readonly #initial: Map<string, boolean>;

	#cursor = 0;
	#scrollOffset = 0;
	#closed = false;

	constructor({ tui, theme, keys, deps, fullscreen, done }: PaneOptions) {
		this.#tui = tui;
		this.#theme = theme;
		this.#keys = keys;
		this.#fullscreen = fullscreen;
		this.#done = done;
		this.#deps = deps;
		this.#entries = [
			...EXTENSION_CATALOG.map(
				(entry): Entry => ({
					kind: "extension",
					name: entry.name,
					label: entry.name,
					description: entry.description,
					enabled: deps.initialEnabled.has(entry.name),
				}),
			),
			...deps.features.map(
				(feature): Entry => ({
					kind: "feature",
					featureId: feature.id,
					label: feature.label,
					description: feature.description,
					enabled: feature.enabled,
				}),
			),
		];
		this.#initial = new Map(this.#entries.map((entry) => [entryKey(entry), entry.enabled]));
	}

	invalidate(): void {

	}

	dispose(): void {
		this.#closed = true;
	}

	handleInput(data: string): void {
		if (this.#closed) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.#finish();
			return;
		}
		if (matchesKey(data, "enter") || matchesKey(data, "return") || matchesKey(data, "space")) {
			this.#toggle();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.#move(-1);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.#move(1);
			return;
		}
		if (
			this.#keys.matches(data, "tui.altScreen.pageUp") ||
			matchesKey(data, "pageUp") ||
			matchesKey(data, "shift+up")
		) {
			this.#move(-this.#pageSize());
			return;
		}
		if (
			this.#keys.matches(data, "tui.altScreen.pageDown") ||
			matchesKey(data, "pageDown") ||
			matchesKey(data, "shift+down")
		) {
			this.#move(this.#pageSize());
			return;
		}
		if (this.#keys.matches(data, "tui.altScreen.top") || matchesKey(data, "home")) {
			this.#cursor = 0;
			this.#requestRender();
			return;
		}
		if (this.#keys.matches(data, "tui.altScreen.bottom") || matchesKey(data, "end")) {
			this.#cursor = this.#entries.length - 1;
			this.#requestRender();
		}
	}

	render(width: number): string[] {
		if (width < 10) return [];
		const theme = this.#theme;
		const paint = (rule: string) => theme.fg("border", rule);
		const total = this.#entries.length;
		this.#cursor = clamp(this.#cursor, 0, Math.max(0, total - 1));

		const viewportHeight = this.#viewportHeight();
		const maxOffset = Math.max(0, total - viewportHeight);
		let offset = clamp(this.#scrollOffset, 0, maxOffset);
		if (this.#cursor < offset) offset = this.#cursor;
		if (this.#cursor >= offset + viewportHeight) offset = this.#cursor - viewportHeight + 1;
		this.#scrollOffset = clamp(offset, 0, maxOffset);

		const visible = this.#entries.slice(this.#scrollOffset, this.#scrollOffset + viewportHeight);
		const rows = visible.map((entry, index) => this.#renderRow(entry, this.#scrollOffset + index, width));

		const enabled = this.#entries.filter((entry) => entry.enabled).length;
		const header = labeledRule(
			width,
			paint,
			[theme.bold(theme.fg("accent", DIALOG_TITLE))],
			[theme.fg("dim", `${enabled} on · ${total - enabled} off`)],
		);
		const footer = labeledRule(width, paint, [theme.fg("dim", HINTS)]);
		return [header, ...rows, footer];
	}

	#renderRow(entry: Entry, index: number, width: number): string {
		const theme = this.#theme;
		const selected = index === this.#cursor;
		const cursor = selected ? theme.fg("accent", `${PROMPT} `) : "  ";
		const box = entry.enabled ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
		const name = entry.label.padEnd(NAME_COLUMN);
		const nameStyled = entry.enabled
			? theme.fg(selected ? "accent" : "text", name)
			: theme.fg("dim", name);
		const description = theme.fg("dim", entry.description);
		return truncateToWidth(`${cursor}${box} ${nameStyled}${description}`, width);
	}

	#viewportHeight(): number {
		const terminalRows = this.#tui.terminal.rows || 40;
		const total = this.#entries.length;
		if (this.#fullscreen) return Math.max(3, Math.min(total, terminalRows - 2));
		const cap = Math.max(3, Math.floor(terminalRows * 0.7) - 2);
		return Math.max(3, Math.min(total, cap));
	}

	#pageSize(): number {
		return Math.max(1, this.#viewportHeight() - 1);
	}

	#move(delta: number): void {
		const total = this.#entries.length;
		this.#cursor = clamp(this.#cursor + delta, 0, Math.max(0, total - 1));
		this.#requestRender();
	}

	#toggle(): void {
		const entry = this.#entries[this.#cursor];
		if (!entry) return;
		entry.enabled = !entry.enabled;
		applyEntry(this.#deps, entry);
		this.#requestRender();
	}

	#finish(): void {
		if (this.#closed) return;
		this.#closed = true;
		const changed = this.#entries.some((entry) => this.#initial.get(entryKey(entry)) !== entry.enabled);
		this.#done(changed);
	}

	#requestRender(): void {
		this.#tui.requestRender();
	}
}
