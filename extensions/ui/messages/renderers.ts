/**
 * Wraps the built-in tool renderers so each call is framed inline: a
 * status-colored pick glyph, the tool name in PascalCase, and no left rule or
 * background box.
 */

import type { Theme, ThemeColor, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Color } from "@earendil-works/pi-tui";
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

	const renderCall: ToolRenderers["renderCall"] = originalCall
		? (args, theme, context) => {
				const frame = frameFor(context);
				const inner = originalCall(args, theme, { ...context, lastComponent: frame.inner });
				neutralise(inner);
				neutralise(context.state?.callComponent);
				frame.set(inner, statusPaint(theme, callStatus(context)), title);
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
				frame.set(inner, undefined, title);
				return frame;
			}
		: undefined;

	return { renderShell: "self", renderCall, renderResult };
}
