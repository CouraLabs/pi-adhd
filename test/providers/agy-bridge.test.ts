import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";

const runAgyTurn = vi.hoisted(() => vi.fn());

vi.mock("../../extensions/providers/agy/runner.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../extensions/providers/agy/runner.ts")>()),
	runAgyTurn,
}));

const { disposeAgySession, getAgyConversationId, handleAgySessionTree, streamAgyTurn } = await import("../../extensions/providers/agy/bridge.ts");
const { registerAgySessionHost } = await import("../../extensions/providers/agy/session-host.ts");
const { AgyTurnTranslator, createAgyAssistantShell } = await import("../../extensions/providers/agy/translate.ts");
const { default: registerAgyProvider } = await import("../../extensions/providers/agy/index.ts");

const SESSION = "pi-session-1";
const model = { id: "agy-model", api: "agy-cli", provider: "agy" } as Model<Api>;

const usage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };

function user(content: string) {
	return { role: "user", content, timestamp: 0 } as TranscriptContext["messages"][number];
}

function assistant(text: string) {
	return { role: "assistant", content: [{ type: "text", text }] } as unknown as TranscriptContext["messages"][number];
}

function host(records: unknown[] = []) {
	return { cwd: "/tmp", persistRecord: (record: unknown) => void records.push(record) };
}

async function runTurn(messages: TranscriptContext["messages"]): Promise<void> {
	const stream = createAssistantMessageEventStream();
	streamAgyTurn(model, { messages } as TranscriptContext, { sessionId: SESSION }, stream);
	for await (const _event of stream) void _event;
}

function lastRequest(): { prompt: string; conversationId: string | undefined } {
	return runAgyTurn.mock.calls.at(-1)![0];
}

describe("agy session_tree", () => {
	let nextConversation = 0;

	beforeEach(() => {
		nextConversation = 0;
		runAgyTurn.mockReset();
		runAgyTurn.mockImplementation(async (request: { conversationId: string | undefined }) => {
			if (request.conversationId === undefined) nextConversation += 1;
			const conversationId = request.conversationId ?? `conv-${nextConversation}`;
			return { result: { conversation_id: conversationId, status: "SUCCESS", response: "ok", usage }, conversationId, stderr: "" };
		});
	});

	afterEach(() => {
		disposeAgySession(SESSION);
	});

	it("keeps the conversation across turns and reseeds a fresh one after a tree switch", async () => {
		registerAgySessionHost(SESSION, host(), undefined);
		await runTurn([user("first")]);
		await runTurn([user("first"), assistant("ok"), user("second")]);
		expect(lastRequest().conversationId).toBe("conv-1");
		expect(getAgyConversationId(SESSION)).toBe("conv-1");

		handleAgySessionTree(SESSION, host());
		expect(getAgyConversationId(SESSION)).toBeUndefined();

		await runTurn([user("first"), assistant("ok"), user("other branch")]);
		const request = lastRequest();
		expect(request.conversationId).toBeUndefined();
		expect(request.prompt).toContain("<context>");
		expect(request.prompt).toContain("[user]\nfirst");
		expect(request.prompt).toContain("[assistant]\nok");
		expect(request.prompt.endsWith("other branch")).toBe(true);
		expect(getAgyConversationId(SESSION)).toBe("conv-2");
	});

	it("ignores a restored record when the tree switches", async () => {
		const restored = { piSessionId: SESSION, conversationId: "old", modelId: "agy-model" };
		registerAgySessionHost(SESSION, host(), restored);
		handleAgySessionTree(SESSION, host());
		await runTurn([user("only")]);
		expect(lastRequest().conversationId).toBeUndefined();
	});

	it("starts fresh without a seed when the tree switch lands before the first turn", async () => {
		registerAgySessionHost(SESSION, host(), undefined);
		handleAgySessionTree(SESSION, host());
		await runTurn([user("first")]);
		const request = lastRequest();
		expect(request.conversationId).toBeUndefined();
		expect(request.prompt).toBe("first");
	});

	it("starts a new conversation on each switch, including back to the original branch", async () => {
		registerAgySessionHost(SESSION, host(), undefined);
		await runTurn([user("a")]);
		handleAgySessionTree(SESSION, host());
		await runTurn([user("a"), assistant("ok"), user("b")]);
		handleAgySessionTree(SESSION, host());
		await runTurn([user("a"), assistant("ok"), user("c")]);
		expect(lastRequest().conversationId).toBeUndefined();
		expect(getAgyConversationId(SESSION)).toBe("conv-3");
	});

	it("resumes the restored conversation on session start", async () => {
		const restored = { piSessionId: SESSION, conversationId: "restored-1", modelId: "agy-model" };
		registerAgySessionHost(SESSION, host(), restored);
		await runTurn([user("a"), assistant("ok"), user("b")]);
		const request = lastRequest();
		expect(request.conversationId).toBe("restored-1");
		expect(request.prompt).toBe("b");
	});

	it("persists the new conversation record after a tree switch", async () => {
		const records: unknown[] = [];
		registerAgySessionHost(SESSION, host(records), undefined);
		await runTurn([user("a")]);
		const afterTree: unknown[] = [];
		handleAgySessionTree(SESSION, host(afterTree));
		await runTurn([user("a"), assistant("ok"), user("b")]);
		expect(records).toEqual([{ piSessionId: SESSION, conversationId: "conv-1", modelId: "agy-model" }]);
		expect(afterTree).toEqual([{ piSessionId: SESSION, conversationId: "conv-2", modelId: "agy-model" }]);
	});

	it("does not record a turn that finishes after the tree switch", async () => {
		let release: () => void = () => undefined;
		runAgyTurn.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = () => resolve({ result: { conversation_id: "stale", status: "SUCCESS", response: "ok", usage }, conversationId: "stale", stderr: "" });
				}),
		);
		const records: unknown[] = [];
		registerAgySessionHost(SESSION, host(records), undefined);
		const pending = runTurn([user("a")]);
		await vi.waitFor(() => expect(runAgyTurn).toHaveBeenCalledTimes(1));
		handleAgySessionTree(SESSION, host(records));
		release();
		await pending;
		expect(records).toEqual([]);
		expect(getAgyConversationId(SESSION)).toBeUndefined();
	});
});

describe("agy queued turn", () => {
	it("reseeds a turn that was waiting behind a running one when the tree switches", async () => {
		const prompts: { prompt: string; conversationId: string | undefined }[] = [];
		let release: () => void = () => undefined;
		runAgyTurn.mockReset();
		runAgyTurn.mockImplementationOnce(
			(request: { prompt: string; conversationId: string | undefined }) =>
				new Promise((resolve) => {
					prompts.push(request);
					release = () => resolve({ result: { conversation_id: "old", status: "SUCCESS", response: "ok", usage }, conversationId: "old", stderr: "" });
				}),
		);
		runAgyTurn.mockImplementation(async (request: { prompt: string; conversationId: string | undefined }) => {
			prompts.push(request);
			return { result: { conversation_id: "new", status: "SUCCESS", response: "ok", usage }, conversationId: "new", stderr: "" };
		});
		registerAgySessionHost(SESSION, host(), undefined);
		const running = runTurn([user("a")]);
		await vi.waitFor(() => expect(prompts).toHaveLength(1));
		const queued = runTurn([user("a"), assistant("ok"), user("b")]);
		handleAgySessionTree(SESSION, host());
		release();
		await Promise.all([running, queued]);
		expect(prompts[1]!.conversationId).toBeUndefined();
		expect(prompts[1]!.prompt).toContain("[user]\na");
		expect(getAgyConversationId(SESSION)).toBe("new");
		disposeAgySession(SESSION);
	});
});

describe("agy provider registration", () => {
	it("advertises text input only", () => {
		const registerProvider = vi.fn();
		const pi = { registerProvider, registerCommand: vi.fn(), on: vi.fn() };
		registerAgyProvider(pi as never);
		const config = registerProvider.mock.calls[0]![1] as { models: { input: string[] }[]; refreshModels: () => Promise<{ input: string[] }[]> };
		expect(config.models.length).toBeGreaterThan(0);
		for (const entry of config.models) expect(entry.input).toEqual(["text"]);
	});
});

describe("agy translator thinking blocks", () => {
	function collect() {
		const events: { type: string; content?: string }[] = [];
		const stream = { push: (event: { type: string; content?: string }) => void events.push(event), end: () => undefined };
		const translator = new AgyTurnTranslator(createAgyAssistantShell(model), stream as never);
		const step = (stepType: string, textDelta: string) =>
			translator.handle({ kind: "step", step: { conversation_id: "c", step_index: 0, state: "ACTIVE", step_type: stepType, text_delta: textDelta } } as never);
		return { events, translator, step };
	}

	it("closes each thinking block with only its own text", () => {
		const { events, step } = collect();
		step("thinking", "first thought");
		step("agent_response", "answer one");
		step("thinking", "second thought");
		step("agent_response", "answer two");
		const ends = events.filter((event) => event.type === "thinking_end").map((event) => event.content);
		expect(ends).toEqual(["first thought", "second thought"]);
		const textEnds = events.filter((event) => event.type === "text_end").map((event) => event.content);
		expect(textEnds).toEqual(["answer one"]);
	});

	it("closes a trailing thinking block on finish with its own text", () => {
		const { events, translator, step } = collect();
		step("thinking", "one");
		step("agent_response", "text");
		step("thinking", "two");
		translator.finishWithResult({ conversation_id: "c", status: "SUCCESS", response: "", usage } as never, "", model);
		const ends = events.filter((event) => event.type === "thinking_end").map((event) => event.content);
		expect(ends).toEqual(["one", "two"]);
	});
});
