import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { HookCallback, McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { allowedSdkToolsForActiveSubmode } from "./policy.ts";
import { toolResultBroker } from "./tool-result-broker.ts";
import type { SdkToolResult } from "./tool-result-broker.ts";

type CallToolResult = Awaited<ReturnType<SdkMcpToolDefinition["handler"]>>;

export const PI_MCP_SERVER_NAME = "pi";
const PI_MCP_TOOL_PREFIX = `mcp__${PI_MCP_SERVER_NAME}__`;

export const PI_OWNED_TOOL_NAMES = ["codemode", "plan-write", "submode-exit"] as const;
export type PiOwnedToolName = (typeof PI_OWNED_TOOL_NAMES)[number];

const PI_OWNED_TOOL_NAME_SET: ReadonlySet<string> = new Set(PI_OWNED_TOOL_NAMES);

export function isPiOwnedToolName(toolName: string): toolName is PiOwnedToolName {
	return PI_OWNED_TOOL_NAME_SET.has(toolName);
}

export function piToolNameFromMcpName(sdkToolName: string): PiOwnedToolName | undefined {
	if (!sdkToolName.startsWith(PI_MCP_TOOL_PREFIX)) return undefined;
	const piToolName = sdkToolName.slice(PI_MCP_TOOL_PREFIX.length);
	return isPiOwnedToolName(piToolName) ? piToolName : undefined;
}

export interface PiToolDescriptions {
	codemode?: string;
	"plan-write"?: string;
	"submode-exit"?: string;
}

const FALLBACK_DESCRIPTIONS: Record<PiOwnedToolName, string> = {
	codemode:
		"Run JavaScript that calls other tools. The input is raw JavaScript run as an async function body in a sandbox; `await tools.<name>({ ...args })` calls a tool, and `return` produces the output.",
	"plan-write":
		"Submit the complete implementation plan, in Markdown, for the user to review line by line. Returns the user's verdict and comments.",
	"submode-exit":
		'Exit the current submode or switch to another one. mode "exit" leaves the submode; "plan", "grill" and "straight" switch to that submode.',
};

const SUBMODE_EXIT_MODES = ["exit", "plan", "grill", "straight"] as const;

interface PendingClaim {
	toolUseId: string;
	toolName: PiOwnedToolName;
	canonicalInput: string;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entryValue]) => entryValue !== undefined)
			.sort(([left], [right]) => left.localeCompare(right));
		return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function toCallToolResult(result: SdkToolResult): CallToolResult {
	return {
		content: result.content.map((block) =>
			block.type === "text"
				? { type: "text" as const, text: block.text }
				: { type: "image" as const, data: block.data, mimeType: block.mimeType },
		),
		...(result.isError ? { isError: true } : {}),
	};
}

function failureResult(message: string): CallToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

function abortSignalOf(extra: unknown): AbortSignal | undefined {
	const signal = (extra as { signal?: unknown } | undefined)?.signal;
	return signal instanceof AbortSignal ? signal : undefined;
}

export class PiToolServer {
	private readonly claims: PendingClaim[] = [];
	readonly server: McpSdkServerConfigWithInstance;

	constructor(descriptions: PiToolDescriptions) {
		const describe = (name: PiOwnedToolName): string => descriptions[name] ?? FALLBACK_DESCRIPTIONS[name];
		this.server = createSdkMcpServer({
			name: PI_MCP_SERVER_NAME,
			version: "1.0.0",
			tools: [
				tool("codemode", describe("codemode"), { code: z.string().describe("Raw JavaScript source.") }, (args, extra) =>
					this.runInPi("codemode", args, extra),
				),
				tool(
					"plan-write",
					describe("plan-write"),
					{ plan: z.string().describe("The complete implementation plan, in Markdown.") },
					(args, extra) => this.runInPi("plan-write", args, extra),
				),
				tool(
					"submode-exit",
					describe("submode-exit"),
					{
						mode: z
							.enum(SUBMODE_EXIT_MODES)
							.describe('Target: "exit" to leave, "plan", "grill", or "straight" to switch.'),
					},
					(args, extra) => this.runInPi("submode-exit", args, extra),
				),
			],
		});
	}

	readonly captureToolUseIdHook: HookCallback = async (input) => {
		if (input.hook_event_name !== "PreToolUse") return {};
		const toolName = piToolNameFromMcpName(input.tool_name);
		if (toolName === undefined) return {};
		const allowed = allowedSdkToolsForActiveSubmode();
		if (allowed !== undefined && !allowed.has(input.tool_name)) return {};
		this.claims.push({ toolUseId: input.tool_use_id, toolName, canonicalInput: canonicalJson(input.tool_input) });
		return {};
	};

	clearClaims(): void {
		this.claims.length = 0;
	}

	private claimToolUseId(toolName: PiOwnedToolName, args: unknown): string | undefined {
		const canonicalInput = canonicalJson(args);
		const sameName = this.claims.filter((claim) => claim.toolName === toolName);
		const match = sameName.find((claim) => claim.canonicalInput === canonicalInput) ?? sameName[0];
		if (!match) return undefined;
		this.claims.splice(this.claims.indexOf(match), 1);
		return match.toolUseId;
	}

	private async runInPi(toolName: PiOwnedToolName, args: unknown, extra: unknown): Promise<CallToolResult> {
		const toolUseId = this.claimToolUseId(toolName, args);
		if (toolUseId === undefined) return failureResult(`pi could not match this ${toolName} call to a tool_use id`);
		try {
			return toCallToolResult(await toolResultBroker.wait(toolUseId, abortSignalOf(extra)));
		} catch (error) {
			return failureResult(error instanceof Error ? error.message : String(error));
		}
	}
}
