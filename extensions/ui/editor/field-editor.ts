/**
 * The pi-adhd prompt editor: a closed field-style box drawn with terminal box
 * characters around the built-in editor, with a `❯` marker on the first input
 * line, and the working directory + git state embedded in the bottom border.
 * The box border color follows the active agent mode (Pi is accented, Work
 * keeps the default border) instead of tracking the thinking level.
 *
 * The box does not host pi's working indicator: the status line lives above
 * the prompt field (see `./status.ts`), so this class passes no
 * `embedWorkingStatus` option and lets pi draw its own top border row.
 */

import {
	CustomEditor,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatCwd } from "../../../shared/format.ts";
import { agentModeBorderColor, getAgentMode } from "../../../shared/modes.ts";
import {
	BOX_BOTTOM_LEFT,
	BOX_BOTTOM_RIGHT,
	BOX_HORIZONTAL,
	BOX_TOP_LEFT,
	BOX_TOP_RIGHT,
	BOX_VERTICAL,
	ELLIPSIS,
	PROMPT,
	SEPARATOR,
} from "../../../shared/glyphs.ts";
import type { GitInfo } from "./git.ts";

/** Hidden-line count a built-in editor border reports (` ↑ 3 more `); 0 when none. */
function scrollCount(border: string | undefined): number {
	if (!border) return 0;
	const plain = border.replace(/\x1b\[[0-9;]*m/g, "");
	const up = /↑\s*(\d+)/.exec(plain);
	if (up) return Number(up[1]);
	const down = /↓\s*(\d+)/.exec(plain);
	return down ? Number(down[1]) : 0;
}

/** Blank columns kept between the box and the terminal edges. */
const BOX_MARGIN = 1;

/** Fields the editor exposes at runtime but not through its public type. */
interface EditorInternals {
	renderedVisibleLineCount?: number;
}

/** Working directory plus git state, and the theme needed to draw the segment. */
export interface EditorLocationInfo {
	cwd: string;
	git: GitInfo;
	theme: Theme;
	/** When true the full working directory is shown; otherwise only its last folder. */
	fullCwd: boolean;
}

export type LocationProvider = () => EditorLocationInfo | undefined;

export class FieldEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly getLocation: LocationProvider,
	) {
		super(tui, theme, keybindings);
		// Keep the box's mode-colored border; the working indicator lives above.
		this.borderColor = (text) => this.paint(text);
	}

	/** Paint a border fragment with the active agent mode's border color. */
	private paint(text: string): string {
		return this.getLocation()?.theme.fg(agentModeBorderColor(getAgentMode()), text) ?? text;
	}

	render(width: number): string[] {
		if (width <= 0) return [];

		// Shrink the side margin before giving up on the box.
		const margin = width >= 8 + BOX_MARGIN * 2 ? BOX_MARGIN : 0;
		const boxWidth = width - margin * 2;
		if (boxWidth < 8) return super.render(width);

		// Columns: `│ ` + `❯ ` + content + ` │`.
		const contentWidth = Math.max(1, boxWidth - 6);
		const lines = super.render(contentWidth);
		if (lines.length < 2) return lines;

		const internals = this as unknown as EditorInternals;
		const maxVisible = Math.max(0, lines.length - 2);
		const visibleCount = Math.min(internals.renderedVisibleLineCount ?? maxVisible, maxVisible);
		const content = lines.slice(1, 1 + visibleCount);
		const trailing = lines.slice(1 + visibleCount + 1);

		const info = this.getLocation();
		const pad = " ".repeat(margin);
		// The built-in editor embeds its scroll state in the borders this wrapper
		// replaces; recover the counts so long multi-line input still says that
		// lines are hidden above or below the box.
		const hiddenAbove = scrollCount(lines[0]);
		const hiddenBelow = scrollCount(lines[1 + visibleCount]);
		const theme = info?.theme;
		const dim = (text: string): string => theme ? theme.fg("dim", text) : text;
		const topLabel = hiddenAbove > 0 ? dim(`↑${hiddenAbove}`) : "";
		const bottomLabel = [
			this.locationSegment(),
			hiddenBelow > 0 ? dim(`↓${hiddenBelow}`) : "",
		]
			.filter(Boolean)
			.join(theme ? theme.fg("dim", SEPARATOR) : SEPARATOR);
		const out: string[] = [pad + this.borderLine(boxWidth, BOX_TOP_LEFT, BOX_TOP_RIGHT, topLabel, "left") + pad];
		content.forEach((line, index) => {
			const prefix = index === 0 ? `${info?.theme.fg('text', PROMPT)} ` : "  ";
			const padded = line + " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
			out.push(pad + this.paint(`${BOX_VERTICAL} ${prefix}`) + padded + this.paint(` ${BOX_VERTICAL}`) + pad);
		});
		out.push(pad + this.borderLine(boxWidth, BOX_BOTTOM_LEFT, BOX_BOTTOM_RIGHT, bottomLabel) + pad);

		// Autocomplete suggestions are rendered after the editor; keep them full width.
		for (const line of trailing) {
			out.push(pad + line + " ".repeat(Math.max(0, boxWidth - visibleWidth(line))) + pad);
		}
		return out;
	}

	/**
	 * Draw a full-width border with corners and an optional label. The label is
	 * right-aligned by default; the top border passes `"left"` so the working
	 * indicator sits at the start of the box, matching pi's built-in editor.
	 */
	private borderLine(
		width: number,
		leftCorner: string,
		rightCorner: string,
		label: string,
		align: "left" | "right" = "right",
	): string {
		if (width <= 0) return "";
		if (width < 2) return this.paint(leftCorner.slice(0, width));

		const inner = width - 2;
		let text = label;
		if (visibleWidth(text) + 3 > inner) {
			const room = Math.max(0, inner - 3);
			text = room > 0 ? truncateToWidth(text, room, ELLIPSIS) : "";
		}
		const labelWidth = visibleWidth(text);
		if (labelWidth === 0) {
			return this.paint(leftCorner + BOX_HORIZONTAL.repeat(inner) + rightCorner);
		}

		const fill = inner - labelWidth - 3;
		if (align === "left") {
			return (
				this.paint(`${leftCorner}${BOX_HORIZONTAL} `) +
				text +
				this.paint(` ${BOX_HORIZONTAL.repeat(fill)}${rightCorner}`)
			);
		}
		return (
			this.paint(`${leftCorner}${BOX_HORIZONTAL.repeat(fill)} `) +
			text +
			this.paint(` ${BOX_HORIZONTAL}${rightCorner}`)
		);
	}

	/** Working directory and git branch/diff, embedded in the bottom border. */
	private locationSegment(): string {
		const info = this.getLocation();
		if (!info) return "";
		const { cwd, git, theme, fullCwd } = info;
		const parts: string[] = [];
		if (cwd) parts.push(theme.fg("text", formatCwd(cwd, fullCwd)));

		const gitParts: string[] = [];
		if (git.branch) gitParts.push(theme.fg("accent", `⌥ ${git.branch}`));
		if (git.additions > 0) gitParts.push(theme.fg("success", `+${git.additions}`));
		if (git.removals > 0) gitParts.push(theme.fg("error", `-${git.removals}`));
		if (gitParts.length > 0) parts.push(gitParts.join(" "));

		return parts.join(theme.fg("dim", SEPARATOR));
	}
}
