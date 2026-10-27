import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type Component, type OverlayOptions, SettingsList, type SettingItem, type TUI } from "@earendil-works/pi-tui";
import { labeledRule } from "../../../shared/labeled-rule.ts";
import type { PomodoroConfig } from "../../../shared/settings.ts";
import { probeTuiMode } from "../../../shared/tui-mode.ts";

const WORK_VALUES = ["15m", "20m", "25m", "30m", "45m", "50m"];
const BREAK_VALUES = ["3m", "5m", "10m"];
const LONG_BREAK_VALUES = ["10m", "15m", "20m", "30m"];
const ROUND_VALUES = ["2", "3", "4", "5", "6"];

function valuesFor(current: string, presets: readonly string[]): string[] {
	return presets.includes(current) ? [...presets] : [current, ...presets];
}

interface PaneOptions {
	tui: TUI;
	theme: Theme;
	defaults: PomodoroConfig;
	done: (config: PomodoroConfig | undefined) => void;
}

export async function showPomodoroConfig(
	ui: ExtensionUIContext,
	defaults: PomodoroConfig,
): Promise<PomodoroConfig | undefined> {
	const mode = await probeTuiMode(ui);
	const fullscreen = mode === "fullscreen";
	const overlayOptions: OverlayOptions = { anchor: "center", width: "70%", maxHeight: "80%", margin: 1 };
	return ui.custom<PomodoroConfig | undefined>(
		(tui, theme, _keys, done) => new PomodoroConfigPane({ tui, theme, defaults, done }),
		fullscreen ? { overlay: true, overlayOptions } : { overlay: false },
	);
}

export class PomodoroConfigPane implements Component {
	readonly #theme: Theme;
	readonly #tui: TUI;
	readonly #list: SettingsList;
	readonly #done: (config: PomodoroConfig | undefined) => void;
	#config: PomodoroConfig;
	#closed = false;

	constructor({ tui, theme, defaults, done }: PaneOptions) {
		this.#tui = tui;
		this.#theme = theme;
		this.#done = done;
		this.#config = { ...defaults };

		const work = `${defaults.workMinutes}m`;
		const short = `${defaults.breakMinutes}m`;
		const long = `${defaults.longBreakMinutes}m`;
		const items: SettingItem[] = [
			{
				id: "work",
				label: "Work",
				currentValue: work,
				values: valuesFor(work, WORK_VALUES),
				description: "Length of one focus session.",
			},
			{
				id: "break",
				label: "Break",
				currentValue: short,
				values: valuesFor(short, BREAK_VALUES),
				description: "Short break between work sessions.",
			},
			{
				id: "longBreak",
				label: "Long break",
				currentValue: long,
				values: valuesFor(long, LONG_BREAK_VALUES),
				description: "Break after the last work session.",
			},
			{
				id: "rounds",
				label: "Rounds",
				currentValue: String(defaults.rounds),
				values: valuesFor(String(defaults.rounds), ROUND_VALUES),
				description: "Work sessions before the long break.",
			},
			{
				id: "start",
				label: "Start",
				currentValue: "▶",
				values: ["▶"],
				description: "Begin the pomodoro session. Esc cancels.",
			},
		];

		const maxVisible = Math.max(5, Math.min(12, (tui.terminal.rows || 40) - 6));
		this.#list = new SettingsList(
			items,
			maxVisible,
			getSettingsListTheme(),
			(id, value) => this.#onChange(id, value),
			() => this.#finish(undefined),
		);
	}

	invalidate(): void {
		this.#list.invalidate();
	}

	dispose(): void {
		this.#closed = true;
	}

	handleInput(data: string): void {
		this.#list.handleInput(data);
	}

	render(width: number): string[] {
		const paint = (rule: string) => this.#theme.fg("border", rule);
		const summary = `${this.#config.workMinutes}m work · ${this.#config.breakMinutes}m break · ${this.#config.rounds} rounds`;
		const header = labeledRule(
			width,
			paint,
			[this.#theme.bold(this.#theme.fg("accent", "Pomodoro"))],
			[this.#theme.fg("dim", summary)],
		);
		return [header, ...this.#list.render(width)];
	}

	#onChange(id: string, value: string): void {
		if (id === "start") {
			this.#finish({ ...this.#config });
			return;
		}
		const minutes = Number.parseInt(value, 10);
		if (!Number.isFinite(minutes) || minutes <= 0) return;
		if (id === "work") this.#config.workMinutes = minutes;
		else if (id === "break") this.#config.breakMinutes = minutes;
		else if (id === "longBreak") this.#config.longBreakMinutes = minutes;
		else if (id === "rounds") this.#config.rounds = minutes;
		this.#tui.requestRender();
	}

	#finish(config: PomodoroConfig | undefined): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#done(config);
	}
}
