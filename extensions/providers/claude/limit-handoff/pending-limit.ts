import { getRateLimits, resetTimestampToMilliseconds } from "../../../../shared/rate-limits.ts";
import type { AgentRunSnapshot } from "../render-agent.ts";

export interface LimitHit {
	readonly resetsAt: number | undefined;
	readonly interruptedAgents: readonly AgentRunSnapshot[];
}

const pendingBySession = new Map<string, LimitHit>();

export function exhaustedWindowResetsAt(now = Date.now()): number | undefined {
	const exhausted = Object.values(getRateLimits()).filter((window) => window.percent >= 99 && window.resetsAt > now);
	return exhausted.length > 0 ? Math.max(...exhausted.map((window) => window.resetsAt)) : undefined;
}

export function recordLimitHit(sessionKey: string, resetsAtSeconds: number | undefined): void {
	const resetsAt = resetsAtSeconds === undefined ? exhaustedWindowResetsAt() : resetTimestampToMilliseconds(resetsAtSeconds);
	const existing = pendingBySession.get(sessionKey);
	pendingBySession.set(sessionKey, { resetsAt: resetsAt ?? existing?.resetsAt, interruptedAgents: existing?.interruptedAgents ?? [] });
}

export function attachInterruptedAgents(sessionKey: string, interruptedAgents: readonly AgentRunSnapshot[]): void {
	const existing = pendingBySession.get(sessionKey);
	if (existing) pendingBySession.set(sessionKey, { ...existing, interruptedAgents });
}

export function clearLimitHit(sessionKey: string): void {
	pendingBySession.delete(sessionKey);
}

export function hasLimitHit(sessionKey: string): boolean {
	return pendingBySession.has(sessionKey);
}

export function takeLimitHit(sessionKey: string): LimitHit | undefined {
	const hit = pendingBySession.get(sessionKey);
	pendingBySession.delete(sessionKey);
	return hit;
}
