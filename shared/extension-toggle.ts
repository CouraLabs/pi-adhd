/**
 * extension-toggle — the interactive `/couralabs:toggle` dialog.
 *
 * Lists every pi-adhd extension with its current state and lets the operator
 * flip one with Enter. Toggles are persisted as they happen, but the extension
 * set is **not** reloaded until the dialog closes: `ctx.reload()` replaces the
 * runtime, which would unmount the dialog mid-interaction. The command handler
 * reloads once afterwards when anything changed.
 *
 * In the TUI the list mounts through `ui.custom` (docked in regular mode, a
 * centered overlay in fullscreen mode, following the plan-review and
 * session-navigator mount strategy). RPC has no custom components, so
 * {@link toggleViaSelect} drives the same state through repeated `ui.select`
 * prompts instead.
 */

import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayOptions, type TUI, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { EXTENSION_CATALOG } from "./extension-catalog.ts";
import type { ExtensionName } from "./extension-registry.ts";
import { PROMPT } from "./glyphs.ts";
import { labeledRule } from "./labeled-rule.ts";
import { probeTuiMode } from "./tui-mode.ts";
import { clamp } from "./util.ts";

/** The settings surface the toggle dialog mutates. */
export interface ExtensionToggleDeps {
	/** Extensions enabled when the dialog opens. */
	initialEnabled: ReadonlySet<ExtensionName>;
	/** Persist one extension's new state. Called on every toggle. */
	setEnabled: (name: ExtensionName, enabled: boolean) => void;
}

interface Entry {
	name: ExtensionName;
	description: string;
	enabled: boolean;
}

const DIALOG_TITLE = "pi-adhd extensions";
const HINTS = "↑↓ move · Enter toggle · Esc close";
/** Width of the name column, shared by every row so the descriptions align. */
const NAME_COLUMN = Math.max(...EXTENSION_CATALOG.map((entry) => entry.name.length)) + 2;

interface PaneOptions {
	tui: TUI;
	theme: Theme;
	keys: KeybindingsManager;
	deps: ExtensionToggleDeps;
	fullscreen: boolean;
	done: (changed: boolean) => void;
}

/** Mount the interactive list. Resolves to whether any extension changed. */
export async function showExtensionToggle(ui: ExtensionUIContext, deps: ExtensionToggleDeps): Promise<boolean> {
	const mode = await probeTuiMode(ui);
	const fullscreen = mode === "fullscreen";
	const overlayOptions: OverlayOptions = { anchor: "center", width: "80%", maxHeight: "80%", margin: 1 };
	return ui.custom<boolean>(
		(tui, theme, keys, done) => new ExtensionTogglePane({ tui, theme, keys, deps, fullscreen, done }),
		fullscreen ? { overlay: true, overlayOptions } : { overlay: false },
	);
}

/**
 * RPC fallback: no custom components, so drive the same toggles through
 * repeated single-choice prompts until the operator picks "Done" or cancels.
 */
export async function toggleViaSelect(ui: ExtensionUIContext, deps: ExtensionToggleDeps): Promise<boolean> {
	const enabled = new Map<ExtensionName, boolean>();
	for (const entry of EXTENSION_CATALOG) enabled.set(entry.name, deps.initialEnabled.has(entry.name));

	let changed = false;
	for (;;) {
		const options = EXTENSION_CATALOG.map(
			(entry) => `${enabled.get(entry.name) ? "[x]" : "[ ]"} ${entry.name} — ${entry.description}`,
		);
		options.push("Done");
		const choice = await ui.select(DIALOG_TITLE, options);
		if (!choice || choice === "Done") break;
		const index = options.indexOf(choice);
		const entry = EXTENSION_CATALOG[index];
		if (!entry) continue;
		const next = !enabled.get(entry.name);
		enabled.set(entry.name, next);
		deps.setEnabled(entry.name, next);
		changed = true;
	}
	return changed;
}

/** The docked/overlay list component. */
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
	readonly #initial: Map<ExtensionName, boolean>;

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
		this.#entries = EXTENSION_CATALOG.map((entry) => ({
			name: entry.name,
			description: entry.description,
			enabled: deps.initialEnabled.has(entry.name),
		}));
		this.#initial = new Map(this.#entries.map((entry) => [entry.name, entry.enabled]));
	}

	invalidate(): void {
		// Rendering is stateless; every line is rebuilt from live state.
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

	// ---- Private ----

	#renderRow(entry: Entry, index: number, width: number): string {
		const theme = this.#theme;
		const selected = index === this.#cursor;
		const cursor = selected ? theme.fg("accent", `${PROMPT} `) : "  ";
		const box = entry.enabled ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
		const name = entry.name.padEnd(NAME_COLUMN);
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
		this.#deps.setEnabled(entry.name, entry.enabled);
		this.#requestRender();
	}

	#finish(): void {
		if (this.#closed) return;
		this.#closed = true;
		const changed = this.#entries.some((entry) => this.#initial.get(entry.name) !== entry.enabled);
		this.#done(changed);
	}

	#requestRender(): void {
		this.#tui.requestRender();
	}
}
