import { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderFooter, type FooterState } from "../../../extensions/ui/footer/render.ts";
import { emptyUsage } from "../../../shared/usage.ts";

const themePath = join(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json");
const themeJson = JSON.parse(readFileSync(themePath, "utf8")) as { colors: Record<string, string>; vars: Record<string, string> };
const colors = Object.fromEntries(Object.entries(themeJson.colors).map(([token, value]) => [token, themeJson.vars[value] ?? value]));
const theme = new Theme(colors as never, {} as never, "truecolor");

const HOUR_MS = 3_600_000;

function state(provider: string, mode: string): FooterState {
	return {
		mode,
		model: { provider, id: "claude-haiku-5-5", name: "Claude Haiku 5.5", reasoning: false, contextWindow: 1_000_000 } as FooterState["model"],
		thinkingLevel: "medium",
		contextUsage: { tokens: 26_000, contextWindow: 1_000_000, percent: 2.6 } as FooterState["contextUsage"],
		usage: { ...emptyUsage(), input: 9_100, output: 21, cost: 0.002 },
		spawnCost: 0,
		timers: [],
		rateLimits: {
			fiveHour: { percent: 3, resetsAt: Date.now() + 4 * HOUR_MS },
			sevenDay: { percent: 33, resetsAt: Date.now() + 80 * HOUR_MS },
		},
		thinkingTokens: 0,
		statuses: new Map(),
		sections: [],
	};
}

function line(footer: FooterState): string {
	return stripTerminalSequences(renderFooter(footer, 400, theme)[0]);
}

describe("renderFooter", () => {
	it("shows the Claude Agent model without the provider, plan limits without gauges, and no cost", () => {
		const text = line(state("claude", "claude"));
		expect(text).toContain("Haiku 5.5");
		expect(text).not.toMatch(/\bclaude\s+(claude\s+)?Haiku/i);
		expect(text).toMatch(/🯵h 3% in \S+/);
		expect(text).toMatch(/🯷d 33% in \S+/);
		expect(text).not.toContain("$");
		expect(text).not.toMatch(/[░▒▓█]/);
	});

	it("keeps the provider and cost for other agents and drops the context gauge", () => {
		const text = line(state("openai", "work"));
		expect(text).toContain("openai");
		expect(text).toContain("$0.002");
		expect(text).toContain("⛁ 3% 26k/1.0M");
		expect(text).not.toMatch(/[░▒▓█]/);
	});
});
