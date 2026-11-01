import { describe, expect, it } from "vitest";
import { buildAgyInputLine, parseAgyLine } from "../../extensions/providers/agy/wire.ts";
import { parseAgyModelsOutput } from "../../extensions/providers/agy/models.ts";

describe("agy wire", () => {
	it("builds a user input line", () => {
		expect(JSON.parse(buildAgyInputLine("hello"))).toEqual({ event: "user", message: { content: "hello" } });
	});

	it("parses init events with extra fields", () => {
		const event = parseAgyLine(
			JSON.stringify({ event: "init", conversation_id: "cid-1", init: { cwd: "/tmp", tools: ["a"], permission_mode: "auto", model: "gemini-3.8-flash-low" } }),
		);
		expect(event?.kind).toBe("init");
		if (event?.kind !== "init") return;
		expect(event.conversationId).toBe("cid-1");
		expect(event.init.model).toBe("gemini-3.8-flash-low");
	});

	it("parses agent_response deltas", () => {
		const event = parseAgyLine(
			JSON.stringify({ event: "step_update", step_update: { conversation_id: "cid-1", step_index: 1, state: "ACTIVE", step_type: "agent_response", text_delta: "Hello" } }),
		);
		expect(event?.kind).toBe("step");
		if (event?.kind !== "step") return;
		expect(event.step.text_delta).toBe("Hello");
	});

	it("parses tool steps with parameters and output", () => {
		const event = parseAgyLine(
			JSON.stringify({
				event: "step_update",
				step_update: {
					conversation_id: "cid-1",
					step_index: 2,
					state: "DONE",
					step_type: "tool",
					tool_name: "run_command",
					tool_info: { name: "run_command", parameters: { CommandLine: "ls" }, output: "ok" },
				},
			}),
		);
		expect(event?.kind).toBe("step");
		if (event?.kind !== "step") return;
		expect(event.step.tool_name).toBe("run_command");
		expect(event.step.tool_info?.output).toBe("ok");
	});

	it("tolerates undocumented step types", () => {
		for (const stepType of ["error_message", "system_message"]) {
			const event = parseAgyLine(
				JSON.stringify({ event: "step_update", step_update: { conversation_id: "cid-1", step_index: 0, state: "DONE", step_type: stepType } }),
			);
			expect(event?.kind).toBe("step");
		}
	});

	it("parses success and error results", () => {
		const success = parseAgyLine(
			JSON.stringify({ event: "result", result: { conversation_id: "cid-1", status: "SUCCESS", response: "hi", duration_seconds: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 3 } } }),
		);
		expect(success?.kind).toBe("result");
		if (success?.kind !== "result") return;
		expect(success.result.status).toBe("SUCCESS");
		expect(success.result.response).toBe("hi");

		const failure = parseAgyLine(
			JSON.stringify({ event: "result", result: { conversation_id: "cid-1", status: "ERROR", response: "", error: "quota", duration_seconds: 0, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 } } }),
		);
		expect(failure?.kind).toBe("result");
	});

	it("ignores non-JSON stderr lines", () => {
		expect(parseAgyLine("warning: --mode auto is not available")).toBeUndefined();
		expect(parseAgyLine("AGY_ERROR: {...}")).toBeUndefined();
		expect(parseAgyLine("")).toBeUndefined();
	});
});

describe("agy models", () => {
	it("parses agy models tab output and skips the fetching line", () => {
		const parsed = parseAgyModelsOutput("Fetching available models...\ngemini-4-argon-medium\tGemini 4 Argon (Medium)\nflash-low   Flash Low\n\nbad line with spaces\n");
		expect(parsed).toEqual([
			{ id: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
			{ id: "flash-low", name: "Flash Low" },
		]);
	});
});
