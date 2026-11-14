import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";

const SDK_EFFORT_LEVELS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

const DEFAULT_EFFORT_BY_THINKING_LEVEL: Readonly<Record<ThinkingLevel, EffortLevel>> = {
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

export const FULL_EFFORT_LEVEL_MAP: ThinkingLevelMap = {
	minimal: null,
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};

export const BASIC_EFFORT_LEVEL_MAP: ThinkingLevelMap = {
	...FULL_EFFORT_LEVEL_MAP,
	xhigh: null,
	max: null,
};

function isSdkEffortLevel(value: unknown): value is EffortLevel {
	return SDK_EFFORT_LEVELS.some((level) => level === value);
}

export function effortForThinkingLevel(level: ThinkingLevel | undefined, levelMap: ThinkingLevelMap | undefined): EffortLevel | undefined {
	if (level === undefined) return undefined;
	const mapped = levelMap?.[level];
	if (isSdkEffortLevel(mapped)) return mapped;
	return DEFAULT_EFFORT_BY_THINKING_LEVEL[level];
}
