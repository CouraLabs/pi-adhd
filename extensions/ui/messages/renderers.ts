/**
 * Wraps the built-in tool renderers so each call is framed inline: a
 * status-colored pick glyph, the tool name in PascalCase, and a dim rule
 * under the glyph down the body rows — no background box.
 */

import { getLanguageFromPath, highlightCode, type Theme, type ThemeColor, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { mixColors, type Color } from "@earendil-works/pi-tui";
import { stripStyling } from "../../../shared/format.ts";
import { ToolFrame, pascalCase } from "./tool-frame.ts";

/** Tool render context type, derived because the package does not re-export it. */
export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/** Lifecycle of one tool row, driving the status glyph's color. */
export type ToolStatus = "called" | "running" | "error" | "finished";

/**
 * Status → semantic color token.
 *
 * Running maps to `accent` because pi has no `info` token: the accent is the
 * info blue in every pi-adhd theme, so in-progress reads as informational
 * while warning/error/success use their own semantic slots.
 */
const STATUS_TOKEN: Record<ToolStatus, ThemeColor> = {
	called: "warning",
	running: "accent",
	error: "error",
	finished: "success",
};

/**
 * The call header's status: `called` while only the streamed arguments exist,
 * `running` while executing, and `finished`/`error` once a final result exists.
 */
export function callStatus(context: ToolRenderContext): ToolStatus {
	if (!context.isPartial) return context.isError ? "error" : "finished";
	return context.executionStarted ? "running" : "called";
}

/** Result-side status: streaming results run; final ones settle into success/error. */
export function resultStatus(options: { isPartial: boolean }, context: ToolRenderContext): ToolStatus {
	return options.isPartial || context.isPartial ? "running" : context.isError ? "error" : "finished";
}

/** The status's semantic color as a Color value from the theme. */
function statusColor(theme: Theme, status: ToolStatus): Color {
	return theme.colors[STATUS_TOKEN[status]];
}

/** Paint the status icon in the status's semantic color. */
function statusPaint(theme: Theme, status: ToolStatus): (text: string) => string {
	const color = statusColor(theme, status);
	return (text) => theme.style(text, { fg: color });
}

/**
 * Restyle the rewritten tool-name token: default text color, bold.
 * Applied only to the spliced token, so the rest of the header keeps the
 * renderer's own styling — and a renderer not carrying the tool name verbatim
 * (bash's `$` prompt) simply skips the restyle with its text untouched.
 */
function nameStyle(theme: Theme): (text: string) => string {
	return (text) => theme.style(text, { fg: "text", bold: true });
}

/** The dim rule below the icon, drawn down every content row. */
function ruleStyle(theme: Theme): (text: string) => string {
	return (text) => theme.fg("dim", text);
}

/** Shell renderers lead their header with the raw command — highlight it in the shell's language. */
const SHELL_LANG: Record<string, string> = { bash: "bash", powershell: "powershell" };

/** Highlight runs per render frame while arguments stream; memoize per command. */
const commandCache = new Map<string, string>();

/**
 * Rewrite a shell header's command in place with syntax colors, keeping the
 * renderer's component identity — and with it pi's tool timer and component
 * reuse — intact. Malformed arguments (no string `command`) leave pi's own
 * header, invalid-arg glyph and all, untouched.
 */
function highlightShellCommand(component: unknown, args: unknown, theme: Theme, title: string, lang: string): void {
	const typed = args as { command?: unknown; timeout?: unknown } | undefined;
	if (typeof typed?.command !== "string") return;
	const timeout = typeof typed.timeout === "number" ? ` (timeout ${typed.timeout}s)` : "";
	const key = `${lang}\u0000${typed.command}`;
	let colored = commandCache.get(key);
	if (colored === undefined) {
		colored = typed.command ? highlightCode(typed.command, lang).join("\n") : theme.fg("toolOutput", "...");
		if (commandCache.size >= 200) commandCache.clear();
		commandCache.set(key, colored);
	}
	(component as { setText?: (text: string) => void }).setText?.(
		`${theme.fg("toolTitle", theme.bold(title))} ${colored}${theme.fg("muted", timeout)}`,
	);
}

/** The diff rows' syntax colors ride the theme; the row memo invalidates on theme change. */
const diffRowCache = new Map<string, string>();
let diffRowCacheTheme: Theme | undefined;

/**
 * Restyle one rendered diff row with the file's syntax colors.
 *
 * pi's diff renderer paints whole lines (added green, removed red, context
 * dim) and inverse-highlights intra-line changes; this replaces the line wash
 * with real syntax colors while keeping the sign-and-line-number gutter in
 * the renderer's semantic colors. Rows that do not parse as diff lines —
 * elision markers, empty gutters — pass through untouched.
 */
function restyleDiffRow(row: string, lang: string, theme: Theme): string {
	if (diffRowCacheTheme !== theme) {
		diffRowCache.clear();
		diffRowCacheTheme = theme;
	}
	const cached = diffRowCache.get(row);
	if (cached !== undefined) return cached;
	let styled = row;
	// The gutter round-trips verbatim — sign, pad, and number exactly as the
	// renderer wrote them — so every row's code column stays aligned. The
	// number is required and the separator is exactly one space (pi's format),
	// so bare-number rows from empty source lines and elision markers fail the
	// parse and pass through untouched instead of their digits styling as code.
	const match = /^([+-]?\s*\d+)( .*)$/.exec(stripStyling(row));
	const gutter = match?.[1] ?? "";
	const content = match ? match[2].slice(1) : "";
	if (match && content.trim() !== "") {
		const sign = gutter.startsWith("+") ? "toolDiffAdded" : gutter.startsWith("-") ? "toolDiffRemoved" : undefined;
		if (sign) {
			// Terminals have no alpha: the wash blends the row's own diff color
			// toward the theme's panel background, reading as a transparent tint
			// over the transcript.
			const wash = mixColors(theme.colors["toolPendingBg"], theme.colors[sign], 0.2);
			styled = `${theme.style(theme.fg(sign, `${gutter} `), { bg: wash })}${theme.style(highlightCode(content, lang)[0] ?? content, { bg: wash })}`;
		} else {
			styled = `${theme.fg("toolDiffContext", `${gutter} `)}${highlightCode(content, lang)[0] ?? content}`;
		}
	}
	if (diffRowCache.size >= 800) diffRowCache.clear();
	diffRowCache.set(row, styled);
	return styled;
}

/** The edit diff's language, from the edited file's extension; undefined when unknown. */
function editLanguage(args: unknown): string | undefined {
	const typed = args as { path?: unknown; file_path?: unknown } | undefined;
	const path = typeof typed?.file_path === "string" ? typed.file_path : typeof typed?.path === "string" ? typed.path : undefined;
	return path ? getLanguageFromPath(path) : undefined;
}

/**
 * The `edit` renderer paints its own background box; strip it so calls render
 * flat like every other tool. Duck-typed so it works even when the host and
 * extension resolve different copies of pi-tui.
 */
function neutralise(component: unknown): void {
	if (!component || typeof component !== "object") return;
	const box = component as {
		setBgFn?: (bgFn: undefined) => void;
		setPaddingX?: (paddingX: number) => void;
	};
	box.setBgFn?.(undefined);
	box.setPaddingX?.(0);
}

function frameFor(context: ToolRenderContext): ToolFrame {
	return context.lastComponent instanceof ToolFrame ? context.lastComponent : new ToolFrame();
}

/**
 * Wrap a tool's renderers, seeding the frame with the PascalCase tool name so
 * the header line can be rewritten in place.
 */
export function wrapRenderers(toolName: string, renderers: ToolRenderers): ToolRenderers {
	const originalCall = renderers.renderCall;
	const originalResult = renderers.renderResult;
	const title = pascalCase(toolName);
	const shellLang = SHELL_LANG[toolName];

	const renderCall: ToolRenderers["renderCall"] = originalCall
		? (args, theme, context) => {
				const frame = frameFor(context);
				const inner = originalCall(args, theme, { ...context, lastComponent: frame.inner });
				if (shellLang) highlightShellCommand(inner, args, theme, title, shellLang);
				neutralise(inner);
				neutralise(context.state?.callComponent);
				const lang = toolName === "edit" ? editLanguage(args) : undefined;
				frame.set(
					inner,
					statusPaint(theme, callStatus(context)),
					title,
					nameStyle(theme),
					ruleStyle(theme),
					lang ? (row) => restyleDiffRow(row, lang, theme) : undefined,
				);
				return frame;
			}
		: undefined;

	const renderResult: ToolRenderers["renderResult"] = originalResult
		? (result, options, theme, context) => {
				const frame = frameFor(context);
				const inner = originalResult(result, options, theme, { ...context, lastComponent: frame.inner });
				neutralise(inner);
				neutralise(context.state?.callComponent);
				// Result bodies render plain — the call header above carries the icon.
				const lang = toolName === "edit" ? editLanguage(context.args) : undefined;
				frame.set(
					inner,
					undefined,
					title,
					nameStyle(theme),
					ruleStyle(theme),
					lang ? (row) => restyleDiffRow(row, lang, theme) : undefined,
				);
				return frame;
			}
		: undefined;

	return { renderShell: "self", renderCall, renderResult };
}
