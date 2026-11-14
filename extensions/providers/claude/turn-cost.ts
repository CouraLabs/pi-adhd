import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

export class TurnCostLedger {
	private readonly costs = new WeakMap<ResultMessage, number>();
	private runningTotal: number | undefined;

	constructor(startsFromZero: boolean) {
		this.runningTotal = startsFromZero ? 0 : undefined;
	}

	observe(result: ResultMessage): void {
		const total = result.total_cost_usd;
		if (typeof total !== "number" || !Number.isFinite(total)) return;
		const previous = this.runningTotal;
		this.runningTotal = total;
		if (previous === undefined) return;
		this.costs.set(result, total >= previous ? total - previous : total);
	}

	costOf(result: ResultMessage): number {
		return this.costs.get(result) ?? 0;
	}
}
