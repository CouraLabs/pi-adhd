import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BOX_HORIZONTAL } from "./glyphs.ts";

const LEAD = `${BOX_HORIZONTAL}${BOX_HORIZONTAL} `;
const TRAIL = ` ${BOX_HORIZONTAL}${BOX_HORIZONTAL}`;

export function labeledRule(
	width: number,
	paint: (rule: string) => string,
	left: readonly string[],
	right: readonly string[] = [],
): string {
	for (const leftLabel of left) {
		for (const rightLabel of [...right, undefined]) {
			if (fits(width, leftLabel, rightLabel)) return compose(width, paint, leftLabel, rightLabel);
		}
	}
	const lastLeft = left.at(-1) ?? "";

	const truncated = truncateToWidth(lastLeft, Math.max(0, width - LEAD.length - 2), "…");
	return compose(width, paint, truncated, undefined);
}

function fits(width: number, left: string, right: string | undefined): boolean {
	return LEAD.length + visibleWidth(left) + 1 + 1 + rightWidth(right) <= width;
}

function compose(width: number, paint: (rule: string) => string, left: string, right: string | undefined): string {
	const fill = BOX_HORIZONTAL.repeat(
		Math.max(1, width - LEAD.length - visibleWidth(left) - 1 - rightWidth(right)),
	);
	const tail = right === undefined ? paint(` ${fill}`) : `${paint(` ${fill} `)}${right}${paint(TRAIL)}`;
	return `${paint(LEAD)}${left}${tail}`;
}

function rightWidth(right: string | undefined): number {
	return right === undefined ? 0 : 1 + visibleWidth(right) + TRAIL.length;
}
