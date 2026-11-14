import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";
import { resetTimestampToMilliseconds, setRateLimitWindow, utilizationToPercent, type RateLimitWindowId } from "../../../shared/rate-limits.ts";

type UnifiedRateLimitWindow = { utilization: number; resetsAt: number };

type RuntimeRateLimitInfo = SDKRateLimitInfo & {
	unifiedWindows?: Partial<Record<string, UnifiedRateLimitWindow>>;
};

const RATE_LIMIT_WINDOWS: Readonly<Record<string, RateLimitWindowId>> = {
	five_hour: "fiveHour",
	seven_day: "sevenDay",
};

function recordRateLimitWindow(windowId: RateLimitWindowId, utilization: number | undefined, resetsAt: number | undefined): void {
	if (utilization === undefined || resetsAt === undefined) return;
	setRateLimitWindow(windowId, {
		percent: utilizationToPercent(utilization),
		resetsAt: resetTimestampToMilliseconds(resetsAt),
	});
}

export function recordRateLimit(info: RuntimeRateLimitInfo): void {
	for (const [windowType, windowId] of Object.entries(RATE_LIMIT_WINDOWS)) {
		const unified = info.unifiedWindows?.[windowType];
		if (unified) recordRateLimitWindow(windowId, unified.utilization, unified.resetsAt);
	}
	const limitingWindowId = info.rateLimitType ? RATE_LIMIT_WINDOWS[info.rateLimitType] : undefined;
	if (limitingWindowId && !info.unifiedWindows?.[info.rateLimitType as string]) {
		recordRateLimitWindow(limitingWindowId, info.utilization, info.resetsAt);
	}
}
