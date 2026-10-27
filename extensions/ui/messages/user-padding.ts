/**
 * The user prompt, restyled: the built-in `UserMessageComponent` draws one
 * full-width blank row above and below the prompt text — the `paddingY: 1`
 * baked into the `Markdown` child that `rebuild()` creates (the rows even
 * carry the `userMessageBg` background, so the prompt reads as a floating
 * box). pi-adhd drops those rows and hangs a default-foreground left rule down
 * the prompt instead, matching the tool frames' rule.
 *
 * The blank `Spacer(1)` row pi inserts *between* messages stays: that is
 * transcript separation, not this box's padding.
 *
 * Patch approach mirrors `ui/thinking`: replace `rebuild` on the prototype
 * with a wrapper that lets the original build its `Markdown`, then zeroes the
 * Markdown's vertical padding and swaps it for a wrapper that prefixes each
 * rendered row with the rule glyph. Duck-typed on the child (not `instanceof`)
 * so this keeps working when the host and this extension resolve different
 * copies of pi-tui.
 */

import { UserMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/** Dim rule drawn on every prompt row, matching the tool frames' glyph. */
const RULE_GLYPH = "│";

/** The rebuilt Markdown child's duck-typed surface. */
type PaddedChild = {
	paddingY?: number;
	render: (width: number) => string[];
	invalidate?: () => void;
};

/** The user-message prototype, viewed as a patchable surface. `rebuild` is private upstream. */
type PatchedPrototype = {
	rebuild?: (() => void) & { __couraFlatUserMessage?: boolean };
};

/** One-space margin, left rule, then the child Markdown's output — two columns narrower so the trio fits the width. */
class RuledUserMessage implements Component {
	constructor(
		private readonly inner: PaddedChild,
		private readonly getTheme: () => Theme | undefined,
	) {}

	render(width: number): string[] {
		const theme = this.getTheme();
		const rule = theme ? theme.fg("text", RULE_GLYPH) : RULE_GLYPH;
		return this.inner.render(width - 2).map((line) => ` ${rule}${line}`);
	}

	invalidate(): void {
		this.inner.invalidate?.();
	}
}

/** Strip the blank padded rows and hang the left rule on every user prompt. */
export function flattenUserMessage(getTheme: () => Theme | undefined): void {
	const prototype = UserMessageComponent.prototype as unknown as PatchedPrototype;
	const originalRebuild = prototype.rebuild;
	if (!originalRebuild || originalRebuild.__couraFlatUserMessage) return;

	const flattenedRebuild = function (this: UserMessageComponent): void {
		originalRebuild.call(this);
		const index = this.children.length - 1;
		const child = this.children[index] as PaddedChild | undefined;
		if (!child || typeof child.paddingY !== "number" || typeof child.render !== "function") return;
		child.paddingY = 0;
		child.invalidate?.();
		this.children[index] = new RuledUserMessage(child, getTheme);
	} as NonNullable<PatchedPrototype["rebuild"]>;
	flattenedRebuild.__couraFlatUserMessage = true;
	prototype.rebuild = flattenedRebuild;
}
