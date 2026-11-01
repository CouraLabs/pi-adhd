export interface AgyUsage {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly thinking_tokens: number;
	readonly cache_read_tokens: number;
	readonly total_tokens: number;
}

export interface AgyInitPayload {
	readonly cwd?: string;
	readonly tools?: string[];
	readonly permission_mode?: string;
	readonly model?: string;
	readonly [key: string]: unknown;
}

export interface AgyStepUpdate {
	readonly conversation_id: string;
	readonly step_index: number;
	readonly state: string;
	readonly step_type: string;
	readonly text_delta?: string;
	readonly tool_name?: string;
	readonly tool_info?: {
		readonly name?: string;
		readonly parameters?: unknown;
		readonly output?: string;
	};
	readonly duration_seconds?: number;
	readonly usage?: AgyUsage;
}

export interface AgyResult {
	readonly conversation_id: string;
	readonly status: string;
	readonly response: string;
	readonly error?: string;
	readonly finished_reason?: string;
	readonly duration_seconds?: number;
	readonly num_turns?: number;
	readonly usage?: AgyUsage;
}

export type AgyOutputEvent =
	| { readonly kind: "init"; readonly conversationId: string; readonly init: AgyInitPayload }
	| { readonly kind: "step"; readonly step: AgyStepUpdate }
	| { readonly kind: "result"; readonly result: AgyResult };

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function textOf(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function parseAgyLine(line: string): AgyOutputEvent | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	const root = asRecord(parsed);
	if (!root) return undefined;
	const event = root.event;
	if (event === "init") {
		const conversationId = textOf(root.conversation_id);
		const init = asRecord(root.init) ?? {};
		if (!conversationId) return undefined;
		return { kind: "init", conversationId, init: init as AgyInitPayload };
	}
	if (event === "step_update") {
		const inner = asRecord(root.step_update);
		if (!inner) return undefined;
		const conversationId = textOf(inner.conversation_id ?? root.conversation_id);
		const stepIndex = inner.step_index;
		if (!conversationId || typeof stepIndex !== "number") return undefined;
		return {
			kind: "step",
			step: {
				conversation_id: conversationId,
				step_index: stepIndex,
				state: textOf(inner.state),
				step_type: textOf(inner.step_type),
				text_delta: typeof inner.text_delta === "string" ? inner.text_delta : undefined,
				tool_name: typeof inner.tool_name === "string" ? inner.tool_name : undefined,
				tool_info: asRecord(inner.tool_info) as AgyStepUpdate["tool_info"],
				duration_seconds: typeof inner.duration_seconds === "number" ? inner.duration_seconds : undefined,
				usage: asRecord(inner.usage) as unknown as AgyUsage | undefined,
			},
		};
	}
	if (event === "result") {
		const inner = asRecord(root.result);
		if (!inner) return undefined;
		const conversationId = textOf(inner.conversation_id ?? root.conversation_id);
		if (!conversationId) return undefined;
		return {
			kind: "result",
			result: {
				conversation_id: conversationId,
				status: textOf(inner.status),
				response: typeof inner.response === "string" ? inner.response : "",
				error: typeof inner.error === "string" ? inner.error : undefined,
				finished_reason: typeof inner.finished_reason === "string" ? inner.finished_reason : undefined,
				duration_seconds: typeof inner.duration_seconds === "number" ? inner.duration_seconds : undefined,
				num_turns: typeof inner.num_turns === "number" ? inner.num_turns : undefined,
				usage: asRecord(inner.usage) as unknown as AgyUsage | undefined,
			},
		};
	}
	return undefined;
}

export function buildAgyInputLine(content: string): string {
	return JSON.stringify({ event: "user", message: { content } });
}

export function agyUsageToPi(usage: AgyUsage | undefined): {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
} {
	if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	const input = usage.input_tokens ?? 0;
	const output = usage.output_tokens ?? 0;
	const cacheRead = usage.cache_read_tokens ?? 0;
	const totalTokens = usage.total_tokens ?? input + output + cacheRead;
	return { input, output, cacheRead, cacheWrite: 0, totalTokens };
}
