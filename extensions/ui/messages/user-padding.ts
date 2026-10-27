import { UserMessageComponent, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

const RULE_GLYPH = "│";

type PaddedChild = {
	paddingY?: number;
	render: (width: number) => string[];
	invalidate?: () => void;
};

type PatchedPrototype = {
	rebuild?: (() => void) & { __couraFlatUserMessage?: boolean };
};

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
