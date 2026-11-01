import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { buildOpencodeContext, sanitizeOpencodeMessages, systemPromptCarriesEnvelope } from "../../../extensions/providers/opencode/stream.ts";
import { OPENCODE_ENV_ENVELOPE } from "../../../extensions/providers/opencode/identity.ts";

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });
const assistant = (text: string): Message => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-completions",
	provider: "opencode-free",
	model: "glm-5.3-flash-free",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: 0,
});
const system = (text: string): Message => ({ role: "system", content: text, timestamp: 0 });

describe("opencode stream context", () => {
	it("drops leading assistant turns", () => {
		expect(sanitizeOpencodeMessages([assistant("early"), user("hi")])).toEqual([user("hi")]);
	});

	it("bridges consecutive assistant turns", () => {
		const cleaned = sanitizeOpencodeMessages([user("hi"), assistant("a"), assistant("b"), user("done")]);
		expect(cleaned.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
	});

	it("closes a trailing assistant turn", () => {
		const cleaned = sanitizeOpencodeMessages([user("hi"), assistant("a")]);
		expect(cleaned.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
	});

	it("prepends the env envelope once on free turns", () => {
		const context = { messages: [system("Be brief."), user("hi")] } as TranscriptContext;
		const first = buildOpencodeContext(context, true);
		expect(systemPromptCarriesEnvelope(first.messages)).toBe(true);
		const again = buildOpencodeContext(first, true);
		const text = JSON.stringify(again.messages[0]);
		expect(text.match(new RegExp(OPENCODE_ENV_ENVELOPE, "g"))).toHaveLength(1);
	});

	it("leaves go turns without the envelope", () => {
		const context = { messages: [system("Be brief."), user("hi")] } as TranscriptContext;
		expect(systemPromptCarriesEnvelope(buildOpencodeContext(context, false).messages)).toBe(false);
	});
});
