/**
 * webfetch-tool.ts — the `webfetch` tool: fetch a URL as plain text.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getFetchConfig } from "./config.ts";
import type { FetchFormat } from "./providers.ts";
import { runFetch } from "./runner.ts";
import { getErrorMessage } from "./util.ts";

type Outcome = "running" | "success" | "cancelled" | "error";
interface Details {
	outcome: Outcome;
	target: string;
	meta: string;
}
interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Details;
	isError?: boolean;
}

function configuredProvider(): string[] | undefined {
	const provider = getFetchConfig().provider;
	return provider === "auto" ? undefined : [provider];
}

function errorResult(error: unknown, target: string, signal?: AbortSignal): ToolResult {
	const cancelled = signal?.aborted === true;
	return {
		content: [
			{
				type: "text",
				text: cancelled ? "Fetch cancelled." : getErrorMessage(error),
			},
		],
		details: {
			outcome: cancelled ? "cancelled" : "error",
			target,
			meta: cancelled ? "cancelled" : "failed",
		},
		...(!cancelled ? { isError: true } : {}),
	};
}

/** The first `max` lines of `text`, for the inline result preview. */
function previewLines(text: string, max: number): string[] {
	const lines = text.split("\n");
	const shown = lines.slice(0, max).map((line) => `  ${line}`);
	if (lines.length > max) shown.push("  ...");
	return shown;
}

export function registerFetchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "webfetch",
		label: "WebFetch",
		description: "Fetch a URL as plain text through a configured provider.",
		promptSnippet: "webfetch(url, format?, max_characters?)",
		renderCall(args: Record<string, unknown>, theme: Theme) {
			const url = String(args.url ?? "");
			return new Text(
				theme.fg("toolTitle", theme.bold("WebFetch")) +
					(url ? "  " + theme.fg("muted", url) : ""),
				0,
				0,
			);
		},
		renderResult(
			result: AgentToolResult<Details | undefined>,
			{ isPartial }: ToolRenderResultOptions,
			theme: Theme,
		) {
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			if (isPartial) {
				return new Text(theme.fg("muted", `  ${text || "Fetching..."}`), 0, 0);
			}
			if (result.isError) {
				return new Text(theme.fg("error", `  ${text}`), 0, 0);
			}
			const meta = result.details?.meta ? theme.fg("dim", `  ${result.details.meta}`) : "";
			const head = meta ? `${meta}\n` : "";
			return new Text(head + previewLines(text, 20).map((l) => theme.fg("muted", l)).join("\n"), 0, 0);
		},
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			format: Type.Optional(
				StringEnum(["markdown", "text", "html"] as const, {
					description: "Upstream provider format. The tool always returns plain text.",
				}),
			),
			max_characters: Type.Optional(
				Type.Number({ description: "Max characters (default 1000, 0 = unlimited)", default: 1000 }),
			),
		}),
		async execute(_id, raw, signal, onUpdate): Promise<ToolResult> {
			const params = raw as {
				url: string;
				format?: FetchFormat;
				max_characters?: number;
			};
			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${params.url}...` }],
				details: { outcome: "running", target: params.url, meta: "running" },
			});
			try {
				const url = new URL(params.url);
				if (url.protocol !== "http:" && url.protocol !== "https:") {
					throw new Error("Fetch URL must use HTTP or HTTPS");
				}
				const maxCharacters = Math.max(params.max_characters ?? 1000, 0);
				const result = await runFetch(
					{
						url: params.url,
						format: params.format ?? "markdown",
						maxCharacters,
						signal,
					},
					configuredProvider(),
				);
				const page = result.data;
				const body = [page.title ? `# ${page.title}` : "", `URL: ${page.url}`, "", page.content]
					.filter((line, index) => line || index === 2)
					.join("\n");
				const text =
					maxCharacters > 0 && body.length > maxCharacters
						? `${body.slice(0, maxCharacters)}\n\n[truncated]`
						: body;
				const fallbackMeta = result.errors.length > 0 ? ` · ${result.errors.length} failed` : "";
				return {
					content: [{ type: "text", text: text.slice(0, 20_000) }],
					details: {
						outcome: "success",
						target: params.url,
						meta: `${body.length} chars · ${result.provider}${fallbackMeta}`,
					},
				};
			} catch (error) {
				return errorResult(error, params.url, signal);
			}
		},
	});
}
