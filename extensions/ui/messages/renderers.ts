import { getLanguageFromPath, highlightCode, type Theme, type ThemeColor, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { getKeybindings, mixColors, type Color, type Component } from "@earendil-works/pi-tui";
import { stripStyling } from "../../../shared/format.ts";
import { ToolFrame, pascalCase } from "./tool-frame.ts";

export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

export type ToolStatus = "called" | "running" | "error" | "finished";

const STATUS_TOKEN: Record<ToolStatus, ThemeColor> = {
	called: "muted",
	running: "warning",
	error: "error",
	finished: "success",
};

export function callStatus(context: ToolRenderContext): ToolStatus {
	if (!context.isPartial) return context.isError ? "error" : "finished";
	return context.executionStarted ? "running" : "called";
}

export function resultStatus(options: { isPartial: boolean }, context: ToolRenderContext): ToolStatus {
	return options.isPartial || context.isPartial ? "running" : context.isError ? "error" : "finished";
}

function statusColor(theme: Theme, status: ToolStatus): Color {
	return theme.colors[STATUS_TOKEN[status]];
}

function statusPaint(theme: Theme, status: ToolStatus): (text: string) => string {
	const color = statusColor(theme, status);
	return (text) => theme.style(text, { fg: color });
}

function nameStyle(theme: Theme): (text: string) => string {
	return (text) => theme.style(text, { fg: "text", bold: true });
}

function ruleStyle(theme: Theme, status: ToolStatus): (text: string) => string {
	return statusPaint(theme, status);
}

const SHELL_LANG: Record<string, string> = { bash: "bash", powershell: "powershell" };

interface TimerState {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return minutes === 0 ? `${(ms / 1000).toFixed(1)}s` : `${minutes}m ${remainder}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

function headerTimer(context: ToolRenderContext): string | undefined {
	const state = (context.state ??= {}) as TimerState;
	if (context.executionStarted && state.startedAt === undefined) {
		state.startedAt = Date.now();
		state.endedAt = undefined;
	}
	const running = context.isPartial && state.startedAt !== undefined;
	if (running && state.interval === undefined) {
		state.interval = setInterval(() => context.invalidate(), 1000);
	}
	if (!running) {
		state.endedAt ??= Date.now();
		if (state.interval !== undefined) {
			clearInterval(state.interval);
			state.interval = undefined;
		}
	}
	if (!running && context.durationMs !== undefined) return `Took ${formatDuration(context.durationMs)}`;
	if (state.startedAt === undefined) return undefined;
	const end = state.endedAt ?? Date.now();
	return `${running ? "Elapsed" : "Took"} ${formatDuration(end - state.startedAt)}`;
}

const commandCache = new Map<string, string>();

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

const diffRowCache = new Map<string, string>();
let diffRowCacheTheme: Theme | undefined;

function restyleDiffRow(row: string, lang: string, theme: Theme): string {
	if (diffRowCacheTheme !== theme) {
		diffRowCache.clear();
		diffRowCacheTheme = theme;
	}
	const cached = diffRowCache.get(row);
	if (cached !== undefined) return cached;
	let styled = row;

	const match = /^([+-]?\s*\d+)( .*)$/.exec(stripStyling(row));
	const gutter = match?.[1] ?? "";
	const content = match ? match[2].slice(1) : "";
	if (match && content.trim() !== "") {
		const sign = gutter.startsWith("+") ? "toolDiffAdded" : gutter.startsWith("-") ? "toolDiffRemoved" : undefined;
		if (sign) {

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

function editLanguage(args: unknown): string | undefined {
	const typed = args as { path?: unknown; file_path?: unknown } | undefined;
	const path = typeof typed?.file_path === "string" ? typed.file_path : typeof typed?.path === "string" ? typed.path : undefined;
	return path ? getLanguageFromPath(path) : undefined;
}

function expandKey(): string {
	const keys = getKeybindings().getKeys("app.tools.expand") ?? [];
	return keys
		.map((key) =>
			key
				.split("+")
				.map((part) => (part.toLowerCase() === "alt" && process.platform === "darwin" ? "option" : part))
				.join("+"),
		)
		.join("/");
}

function collapseEditRows(rows: string[], theme: Theme): string[] {
	const [header, ...body] = rows;
	let hidden = 0;
	const kept = body.filter((row) => {
		const bare = stripStyling(row).trim();
		if (bare === "") return false;
		if (bare.startsWith("+") || bare.startsWith("-")) return true;
		if (/^\d/.test(bare)) {

			hidden++;
			return false;
		}

		if (bare === "...") return false;
		return true;
	});
	if (hidden > 0) {

		kept.push(theme.fg("muted", `… ${hidden} context line${hidden === 1 ? "" : "s"} hidden · ${expandKey()} to expand`));
	}
	return header === undefined ? kept : [header, ...kept];
}

class EditBody implements Component {
	collapsed = false;
	private inner: Component | undefined;
	private theme: Theme | undefined;

	wrap(inner: Component, theme: Theme): void {
		this.inner = inner;
		this.theme = theme;
	}

	render(width: number): string[] {
		const rows = this.inner?.render(width) ?? [];
		if (!this.collapsed || !this.theme || rows.length <= 1) return rows;
		return collapseEditRows(rows, this.theme);
	}

	invalidate(): void {
		this.inner?.invalidate();
	}
}

const editBodies = new WeakMap<ToolFrame, EditBody>();

function editBodyFor(frame: ToolFrame): EditBody {
	let body = editBodies.get(frame);
	if (!body) {
		body = new EditBody();
		editBodies.set(frame, body);
	}
	return body;
}

function resultSummary(
	toolName: string,
	result: Parameters<NonNullable<ToolRenderers["renderResult"]>>[0],
	args: unknown,
	theme: Theme,
): string {
	const countLines = (text: string): number => (text.trim() === "" ? 0 : text.replace(/\n+$/, "").split("\n").length);
	const plural = (lines: number): string => `${lines} line${lines === 1 ? "" : "s"}`;
	if (toolName === "write") {
		const content = (args as { content?: unknown } | undefined)?.content;
		if (typeof content === "string" && content.trim() !== "") return theme.fg("muted", `wrote ${plural(countLines(content))}`);
	}
	const text = (result.content ?? [])
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text)
		.join("\n");
	const lines = countLines(text);
	return theme.fg("muted", lines > 0 ? plural(lines) : "no output");
}

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
				const status = callStatus(context);

				let body: Component = inner;
				if (toolName === "edit") {
					const editBody = editBodyFor(frame);
					editBody.collapsed = !context.expanded;
					editBody.wrap(inner, theme);
					body = editBody;
				}
				const timer = shellLang === undefined ? headerTimer(context) : undefined;
				frame.set(
					body,
					statusPaint(theme, status),
					title,
					nameStyle(theme),
					ruleStyle(theme, status),
					lang ? (row) => restyleDiffRow(row, lang, theme) : undefined,
					undefined,
					timer !== undefined ? theme.fg("muted", timer) : undefined,
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

				const lang = toolName === "edit" ? editLanguage(context.args) : undefined;
				frame.set(
					inner,
					undefined,
					title,
					nameStyle(theme),
					ruleStyle(theme, resultStatus(options, context)),
					lang ? (row) => restyleDiffRow(row, lang, theme) : undefined,
					options.isPartial || context.isPartial ? undefined : resultSummary(toolName, result, context.args, theme),
				);
				return frame;
			}
		: undefined;

	return { renderShell: "self", renderCall, renderResult };
}
