import type { ThinkingLevel as SdkThinkingLevel } from "@earendil-works/pi-ai";

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly (SdkThinkingLevel | "off")[];

export type SpawnThinkingLevel = (typeof THINKING_LEVELS)[number];

export function parseThinkingLevel(value: unknown): SpawnThinkingLevel | undefined {
  return THINKING_LEVELS.find((level): boolean => level === value);
}

export function thinkingLevelError(value: unknown): string {
  return `Invalid thinking level ${describeRejected(value)}. Valid levels: ${THINKING_LEVELS.join(", ")}.`;
}

function describeRejected(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `of type ${typeof value}`;
}
