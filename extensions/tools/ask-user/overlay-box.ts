import type { Theme } from "@earendil-works/pi-coding-agent";
import { padding, SYMBOLS, truncateToWidth, visibleWidth } from "./compat.ts";

export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	const w = visibleWidth(text);
	if (w === width) return text;
	if (w < width) return text + padding(width - w);
	const cut = truncateToWidth(text, width, "");
	const cw = visibleWidth(cut);
	return cw < width ? cut + padding(width - cw) : cut;
}

export function topBorder(theme: Theme, width: number, title: string): string {
	const box = SYMBOLS.boxRound;
	const inner = Math.max(0, width - 2);
	if (!title) return theme.fg("border", box.topLeft + box.horizontal.repeat(inner) + box.topRight);
	const shown = truncateToWidth(` ${title} `, Math.max(0, inner - 2), "");
	const fillWidth = Math.max(0, inner - 1 - visibleWidth(shown));
	return (
		theme.fg("border", box.topLeft + box.horizontal) +
		theme.bold(theme.fg("accent", shown)) +
		theme.fg("border", box.horizontal.repeat(fillWidth) + box.topRight)
	);
}

export function divider(theme: Theme, width: number): string {
	const box = SYMBOLS.boxRound;
	return theme.fg("border", box.teeRight + box.horizontal.repeat(Math.max(0, width - 2)) + box.teeLeft);
}

export function bottomBorder(theme: Theme, width: number): string {
	const box = SYMBOLS.boxRound;
	return theme.fg("border", box.bottomLeft + box.horizontal.repeat(Math.max(0, width - 2)) + box.bottomRight);
}

export function row(theme: Theme, content: string, width: number): string {
	const box = SYMBOLS.boxRound;
	return `${theme.fg("border", box.vertical)} ${fit(content, Math.max(0, width - 4))} ${theme.fg("border", box.vertical)}`;
}
