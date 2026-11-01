import { spawn } from "node:child_process";
import { AGY_BINARY } from "./identity.ts";
import { buildAgyInputLine, parseAgyLine } from "./wire.ts";
import type { AgyOutputEvent, AgyResult, AgyStepUpdate } from "./wire.ts";

export interface AgyTurnRequest {
	readonly prompt: string;
	readonly modelId: string;
	readonly conversationId: string | undefined;
	readonly cwd: string;
	readonly signal: AbortSignal | undefined;
	readonly onEvent: (event: AgyOutputEvent) => void;
}

export interface AgyTurnOutcome {
	readonly result: AgyResult;
	readonly conversationId: string;
	readonly stderr: string;
}

function buildAgyArgs(modelId: string, conversationId: string | undefined): string[] {
	const args = [
		"--print",
		"",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--mode",
		"auto",
		"--dangerously-skip-permissions",
		"--model",
		modelId,
	];
	if (conversationId) args.push("--conversation", conversationId);
	return args;
}

export function runAgyTurn(request: AgyTurnRequest): Promise<AgyTurnOutcome> {
	return new Promise((resolve, reject) => {
		const child = spawn(AGY_BINARY, buildAgyArgs(request.modelId, request.conversationId), {
			cwd: request.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let settled = false;
		let stdoutBuffer = "";
		let stderrText = "";
		let observedConversationId = request.conversationId;
		let stepHandler: ((event: AgyOutputEvent) => void) | undefined = request.onEvent;

		const finish = (outcome: () => void): void => {
			if (settled) return;
			settled = true;
			outcome();
		};

		const kill = (): void => {
			stepHandler = undefined;
			try {
				child.kill("SIGTERM");
			} catch {
				return;
			}
		};

		request.signal?.addEventListener("abort", kill, { once: true });

		const handleLine = (line: string): void => {
			const event = parseAgyLine(line);
			if (!event) return;
			if (event.kind === "init") observedConversationId = event.conversationId;
			if (event.kind === "result" && event.result.conversation_id) observedConversationId = event.result.conversation_id;
			stepHandler?.(event);
			if (event.kind !== "result") return;
			const result = event.result;
			finish(() => {
				request.signal?.removeEventListener("abort", kill);
				resolve({ result, conversationId: observedConversationId ?? result.conversation_id, stderr: stderrText });
			});
		};

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdoutBuffer += chunk;
			let newline = stdoutBuffer.indexOf("\n");
			while (newline >= 0) {
				const line = stdoutBuffer.slice(0, newline);
				stdoutBuffer = stdoutBuffer.slice(newline + 1);
				handleLine(line);
				if (settled) return;
				newline = stdoutBuffer.indexOf("\n");
			}
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderrText += chunk;
		});

		child.on("error", (error) => {
			finish(() => {
				request.signal?.removeEventListener("abort", kill);
				reject(new Error(`agy CLI failed to start: ${error.message}`));
			});
		});

		child.on("close", (code) => {
			if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
			if (settled) return;
			if (request.signal?.aborted) {
				finish(() => {
					request.signal?.removeEventListener("abort", kill);
					reject(new Error("agy turn aborted"));
				});
				return;
			}
			finish(() => {
				request.signal?.removeEventListener("abort", kill);
				reject(new Error(`agy CLI exited with code ${code ?? "unknown"} before returning a result${stderrText.trim() ? `: ${stderrText.trim().slice(0, 500)}` : ""}`));
			});
		});
		try {
			child.stdin.write(`${buildAgyInputLine(request.prompt)}\n`);
			child.stdin.end();
		} catch (error) {
			finish(() => {
				request.signal?.removeEventListener("abort", kill);
				reject(error instanceof Error ? error : new Error(String(error)));
			});
		}
	});
}

export function summarizeToolStep(step: AgyStepUpdate): string {
	const name = step.tool_name ?? step.tool_info?.name ?? "tool";
	const parameters = step.tool_info?.parameters;
	let detail = "";
	if (parameters && typeof parameters === "object") {
		const record = parameters as Record<string, unknown>;
		const candidate = [record.CommandLine, record.command, record.file_path, record.path, record.url, record.query]
			.find((value) => typeof value === "string" && value.length > 0) as string | undefined;
		if (candidate) detail = ` ${candidate.slice(0, 120)}`;
	}
	return `${name}${detail}`;
}
