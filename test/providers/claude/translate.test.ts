import { describe, expect, it } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Api, AssistantMessageEvent, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { TurnTranslator, createAssistantShell } from "../../../extensions/providers/claude/translate.ts";

const MODEL = { id: "claude-opus-5-5", api: "claude-agent-sdk", provider: "claude" } as Model<Api>;

function harness(costs = new Map<SDKMessage, number>()) {
	const events: AssistantMessageEvent[] = [];
	let ended = false;
	const stream = {
		push: (event: AssistantMessageEvent) => events.push(event),
		end: () => {
			ended = true;
		},
	} as unknown as AssistantMessageEventStream;
	const streamed = new Set<string>();
	const toolCalls: string[] = [];
	const output = createAssistantShell(MODEL);
	const translator = new TurnTranslator(output, stream, {
		onToolCall: (id) => toolCalls.push(id),
		markStreamed: (id) => streamed.add(id),
		wasStreamed: (id) => streamed.has(id),
		turnCostOf: (result) => costs.get(result) ?? 0,
	});
	const feed = (...messages: unknown[]) => {
		for (const message of messages) translator.handle(message as SDKMessage);
	};
	return { events, output, translator, toolCalls, feed, isEnded: () => ended };
}

function streamEvent(event: unknown): unknown {
	return { type: "stream_event", parent_tool_use_id: null, event };
}

function assistant(id: string, content: unknown[], usage: unknown = undefined): unknown {
	return { type: "assistant", parent_tool_use_id: null, message: { id, model: "claude-opus-5-5", content, usage } };
}

function result(fields: Record<string, unknown> = {}): unknown {
	return {
		type: "result",
		subtype: "success",
		is_error: false,
		result: "",
		num_turns: 1,
		stop_reason: "end_turn",
		total_cost_usd: 0,
		usage: { input_tokens: 0, output_tokens: 0 },
		...fields,
	};
}

describe("TurnTranslator", () => {
	it("renders a reply that Claude Code delivered without streaming", () => {
		const { feed, output, events, translator } = harness();
		feed(assistant("msg_1", [{ type: "thinking", thinking: "plan" }, { type: "text", text: "Hello" }]), result());
		expect(output.content).toEqual([
			{ type: "thinking", thinking: "plan" },
			{ type: "text", text: "Hello" },
		]);
		expect(events.map((event) => event.type)).toContain("text_delta");
		expect(translator.completedNormally).toBe(true);
	});

	it("does not duplicate a streamed reply when the complete message follows", () => {
		const { feed, output } = harness();
		feed(
			streamEvent({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 10 } } }),
			streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
			streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
			streamEvent({ type: "content_block_stop", index: 0 }),
			assistant("msg_1", [{ type: "text", text: "Hi" }]),
			streamEvent({ type: "message_stop" }),
			result(),
		);
		expect(output.content).toEqual([{ type: "text", text: "Hi" }]);
	});

	it("pauses for tool results on a non-streamed mirrored tool call", () => {
		const { feed, output, toolCalls, translator, isEnded } = harness();
		feed(assistant("msg_1", [{ type: "tool_use", id: "tool_1", name: "Bash", input: { command: "ls" } }]));
		expect(output.content).toEqual([{ type: "toolCall", id: "tool_1", name: "Bash", arguments: { command: "ls" } }]);
		expect(toolCalls).toEqual(["tool_1"]);
		expect(translator.pausedForToolResults).toBe(true);
		expect(isEnded()).toBe(true);
	});

	it("takes tool arguments from the complete message over the streamed JSON", () => {
		const { feed, output } = harness();
		feed(
			streamEvent({ type: "message_start", message: { id: "msg_1" } }),
			streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "Read" } }),
			streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"file_path":"/a' } }),
			streamEvent({ type: "content_block_stop", index: 0 }),
			assistant("msg_1", [{ type: "tool_use", id: "tool_1", name: "Read", input: { file_path: "/a.ts", limit: 5 } }]),
		);
		expect(output.content[0]).toMatchObject({ type: "toolCall", arguments: { file_path: "/a.ts", limit: 5 } });
	});

	it("reports context from the last API call instead of summing calls", () => {
		const { feed, output } = harness();
		feed(
			streamEvent({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 1 } } }),
			streamEvent({ type: "message_delta", usage: { output_tokens: 40 } }),
			streamEvent({ type: "message_stop" }),
			streamEvent({ type: "message_start", message: { id: "msg_2", usage: { input_tokens: 150, cache_read_input_tokens: 1000, output_tokens: 1 } } }),
			streamEvent({ type: "message_delta", usage: { output_tokens: 60 } }),
			streamEvent({ type: "message_stop" }),
			result({ num_turns: 2 }),
		);
		expect(output.usage).toMatchObject({ input: 150, cacheRead: 1000, cacheWrite: 0, output: 100, totalTokens: 1250 });
	});

	it("charges the turn its own cost from the ledger", () => {
		const turnResult = result({ total_cost_usd: 3 });
		const { feed, output } = harness(new Map([[turnResult as SDKMessage, 0.25]]));
		feed(turnResult);
		expect(output.usage.cost.total).toBe(0.25);
	});

	it("explains a server failure that Claude Code reported as a successful result", () => {
		const { feed, output } = harness();
		feed(result({ is_error: true, api_error_status: 529, result: "API Error: 529" }));
		expect(output.stopReason).toBe("error");
		expect(output.errorMessage).toContain("overloaded (529)");
	});

	it("names the subscription window and reset time when the limit is hit", () => {
		const { feed, output } = harness();
		feed(
			{ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1_900_000_000 } },
			{ type: "assistant", parent_tool_use_id: null, error: "rate_limit", message: { id: "x", model: "<synthetic>", content: [] } },
			result({ is_error: true, api_error_status: 429, result: "limit" }),
		);
		expect(output.errorMessage).toMatch(/^Claude subscription limit reached \(five hour\)\. Resets at /);
	});
});
