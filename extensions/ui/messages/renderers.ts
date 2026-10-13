/**
 * Wraps the built-in tool renderers so each call/result is drawn behind a
 * status-colored left rule instead of a full background.
 */

import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Color, colorToOklch, oklchColor } from "@earendil-works/pi-tui";
import { BorderedTool } from "./bordered-tool.ts";

/** Tool render context type, derived because the package does not re-export it. */
export type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/**
 * The rule is drawn with the status's semantic color instead of the theme's
 * `tool*Bg` token: those tokens are often neutral fills (Gruvbox's success
 * background is a warm gray), which left the rule looking gray rather than
 * green. The semantic color is pushed to a bright pastel so it reads on its own
 * — high lightness, capped chroma, hue preserved — with a lower target on light
 * themes so it keeps contrast against the page.
 */
const PASTEL_DARK = { lightness: 0.86, chroma: 0.1 } as const;
const PASTEL_LIGHT = { lightness: 0.72, chroma: 0.14 } as const;

/** Brighten a color to a pastel of the same hue, tuned for the theme's appearance. */
function pastel(color: Color, appearance: Theme["appearance"]): Color {
	const { c, h } = colorToOklch(color);
	const target = appearance === "light" ? PASTEL_LIGHT : PASTEL_DARK;
	return oklchColor(target.lightness, Math.min(c, target.chroma), h);
}

/** Pick the tool's semantic status color, rendered as a bright pastel for the left rule. */
export function statusPaint(theme: Theme, context: ToolRenderContext): (text: string) => string {
	const color = context.isError
		? theme.colors.error
		: context.isPartial
			? theme.colors.warning
			: theme.colors.success;
	const rule = pastel(color, theme.appearance);
	return (text) => theme.style(text, { fg: rule });
}

/**
 * The `edit` renderer paints its own background box; strip it so the left rule shows instead.
 * Duck-typed so it works even when the host and extension resolve different copies of pi-tui.
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

function wrapperFor(context: ToolRenderContext): BorderedTool {
	return context.lastComponent instanceof BorderedTool ? context.lastComponent : new BorderedTool();
}

export function wrapRenderers(renderers: ToolRenderers): ToolRenderers {
	const originalCall = renderers.renderCall;
	const originalResult = renderers.renderResult;

	const renderCall: ToolRenderers["renderCall"] = originalCall
		? (args, theme, context) => {
				const wrapper = wrapperFor(context);
				const inner = originalCall(args, theme, { ...context, lastComponent: wrapper.inner });
				neutralise(inner);
				neutralise(context.state?.callComponent);
				wrapper.set(
					inner,
					statusPaint(theme, context),
					context.outputPad,
					(text) => theme.style(text, { bold: true }),
					true,
				);
				return wrapper;
			}
		: undefined;

	const renderResult: ToolRenderers["renderResult"] = originalResult
		? (result, options, theme, context) => {
				const wrapper = wrapperFor(context);
				const inner = originalResult(result, options, theme, { ...context, lastComponent: wrapper.inner });
				neutralise(inner);
				neutralise(context.state?.callComponent);
				wrapper.set(
					inner,
					statusPaint(theme, context),
					context.outputPad,
					(text) => theme.style(text, { bold: true }),
					false,
				);
				return wrapper;
			}
		: undefined;

	return { renderShell: "self", renderCall, renderResult };
}
