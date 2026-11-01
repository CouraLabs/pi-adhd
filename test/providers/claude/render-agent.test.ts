import { describe, expect, it } from "vitest";
import { cleanAgentReport } from "../../../extensions/providers/claude/render-agent.ts";

const NOTE = (id: string): string =>
	`    This agent's report was delivered to you as a message from "${id}" (its SubagentHandback call). Read it there; it is not repeated here.`;

describe("cleanAgentReport", () => {
	it("strips the handoff frame, usage block, and agentId lines", () => {
		const text = ["Framing:", "The report follows:", "    Did the work.", "    <usage>tokens</usage>", "    agentId: abc"].join("\n");
		expect(cleanAgentReport(text)).toBe("Did the work.");
	});

	it("returns the text as-is when there is no frame", () => {
		expect(cleanAgentReport("Plain report\nsecond line")).toBe("Plain report\nsecond line");
	});

	it("keeps the handback note once when the result contains it twice", () => {
		const text = [NOTE("a8bbb7f0ed90c96bf8"), NOTE("a8bbb7f0ed90c96bf8")].join("\n");
		expect(cleanAgentReport(text)).toBe(cleanAgentReport(NOTE("a8bbb7f0ed90c96bf8")));
	});

	it("keeps notes from distinct handback messages", () => {
		const text = [NOTE("aaaa"), NOTE("bbbb")].join("\n");
		const cleaned = cleanAgentReport(text);
		expect(cleaned).toContain('"aaaa"');
		expect(cleaned).toContain('"bbbb"');
	});
});
