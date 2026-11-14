import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnCostLedger } from "../../../extensions/providers/claude/turn-cost.ts";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

function result(total: number): ResultMessage {
	return { type: "result", total_cost_usd: total } as ResultMessage;
}

describe("TurnCostLedger", () => {
	it("splits the running session total into per-turn costs", () => {
		const ledger = new TurnCostLedger(true);
		const first = result(0.5);
		const second = result(1.25);
		ledger.observe(first);
		ledger.observe(second);
		expect(ledger.costOf(first)).toBe(0.5);
		expect(ledger.costOf(second)).toBe(0.75);
	});

	it("skips the first result of a resumed session whose total includes earlier turns", () => {
		const ledger = new TurnCostLedger(false);
		const first = result(4);
		const second = result(4.5);
		ledger.observe(first);
		ledger.observe(second);
		expect(ledger.costOf(first)).toBe(0);
		expect(ledger.costOf(second)).toBe(0.5);
	});

	it("restarts from the new total after a reset", () => {
		const ledger = new TurnCostLedger(true);
		ledger.observe(result(2));
		const afterClear = result(0.1);
		ledger.observe(afterClear);
		expect(ledger.costOf(afterClear)).toBe(0.1);
	});
});
