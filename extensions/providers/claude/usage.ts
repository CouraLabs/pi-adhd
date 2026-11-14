import type { Usage } from "@earendil-works/pi-ai";

export interface ApiUsage {
	readonly input_tokens?: number | null;
	readonly cache_read_input_tokens?: number | null;
	readonly cache_creation_input_tokens?: number | null;
	readonly output_tokens?: number | null;
	readonly output_tokens_details?: { readonly thinking_tokens?: number | null } | null;
}

interface CallCounts {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	reasoning: number;
}

function emptyCounts(): CallCounts {
	return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
}

export class UsageTracker {
	private readonly calls = new Map<string, CallCounts>();
	private lastCallId: string | undefined;

	get seen(): boolean {
		return this.calls.size > 0;
	}

	record(callId: string, usage: ApiUsage | null | undefined): void {
		if (!usage) return;
		let counts = this.calls.get(callId);
		if (!counts) {
			counts = emptyCounts();
			this.calls.set(callId, counts);
			this.lastCallId = callId;
		}
		counts.input = Math.max(counts.input, usage.input_tokens ?? 0);
		counts.cacheRead = Math.max(counts.cacheRead, usage.cache_read_input_tokens ?? 0);
		counts.cacheWrite = Math.max(counts.cacheWrite, usage.cache_creation_input_tokens ?? 0);
		counts.output = Math.max(counts.output, usage.output_tokens ?? 0);
		counts.reasoning = Math.max(counts.reasoning, usage.output_tokens_details?.thinking_tokens ?? 0);
	}

	recordTurnTotal(usage: ApiUsage): void {
		if (this.calls.size <= 1) this.record(this.lastCallId ?? "result", usage);
	}

	applyTo(target: Usage): void {
		const last = this.lastCallId === undefined ? undefined : this.calls.get(this.lastCallId);
		let output = 0;
		let reasoning = 0;
		for (const counts of this.calls.values()) {
			output += counts.output;
			reasoning += counts.reasoning;
		}
		target.input = last?.input ?? 0;
		target.cacheRead = last?.cacheRead ?? 0;
		target.cacheWrite = last?.cacheWrite ?? 0;
		target.output = output;
		if (reasoning > 0) target.reasoning = reasoning;
		target.totalTokens = target.input + target.cacheRead + target.cacheWrite + target.output;
	}
}
