import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	ExtensionAPI,
	Theme,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getSearchConfig } from "./config.ts";
import type { SearchType } from "./search-providers.ts";
import { runSearch } from "./search-runner.ts";
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
	const provider = getSearchConfig().provider;
	return provider === "auto" ? undefined : [provider];
}

function errorResult(error: unknown, target: string, signal?: AbortSignal): ToolResult {
	const cancelled = signal?.aborted === true;
	return {
		content: [
			{
				type: "text",
				text: cancelled ? "Search cancelled." : getErrorMessage(error),
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

export function registerSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "websearch",
		label: "WebSearch",
		description: "Search the web through a configured provider.",
		promptSnippet: "websearch(query, search_type?, max_results?)",
		renderCall(args: Record<string, unknown>, theme: Theme) {
			const query = String(args.query ?? "");
			return new Text(
				theme.fg("toolTitle", theme.bold("WebSearch")) +
					(query ? "  " + theme.fg("muted", query) : ""),
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
				return new Text(theme.fg("muted", `  ${text || "Searching..."}`), 0, 0);
			}
			if (result.isError) {
				return new Text(theme.fg("error", `  ${text}`), 0, 0);
			}
			const meta = result.details?.meta ? theme.fg("dim", `  ${result.details.meta}`) : "";
			const head = meta ? `${meta}\n` : "";
			const lines = text.split("\n").slice(0, 20).map((line) => theme.fg("muted", `  ${line}`));
			if (text.split("\n").length > 20) lines.push(theme.fg("muted", "  ..."));
			return new Text(head + lines.join("\n"), 0, 0);
		},
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			search_type: Type.Optional(
				StringEnum(["web", "news"] as const, {
					description: "Search type (default web).",
				}),
			),
			max_results: Type.Optional(
				Type.Number({ description: "Max results (default 5, max 10)", default: 5 }),
			),
		}),
		async execute(_id, raw, signal, onUpdate): Promise<ToolResult> {
			const params = raw as {
				query: string;
				search_type?: SearchType;
				max_results?: number;
			};
			onUpdate?.({
				content: [{ type: "text", text: `Searching: ${params.query}...` }],
				details: { outcome: "running", target: params.query, meta: "running" },
			});
			try {
				const maxResults = Math.min(Math.max(params.max_results ?? 5, 1), 10);
				const result = await runSearch(
					{
						query: params.query,
						searchType: params.search_type ?? "web",
						maxResults,
						signal,
					},
					configuredProvider(),
				);
				const text = result.data
					.map((item, index) => {
						const meta = item.publishedAt ? `\n   ${item.publishedAt}` : "";
						return `${index + 1}. ${item.title || item.url}\n   ${item.url}${meta}${item.snippet ? `\n   ${item.snippet}` : ""}`;
					})
					.join("\n\n");
				const fallbackMeta = result.errors.length > 0 ? ` · ${result.errors.length} failed` : "";
				return {
					content: [{ type: "text", text: text || "No results." }],
					details: {
						outcome: "success",
						target: params.query,
						meta: `${result.data.length} ${result.data.length === 1 ? "result" : "results"} · ${result.provider}${fallbackMeta}`,
					},
				};
			} catch (error) {
				return errorResult(error, params.query, signal);
			}
		},
	});
}
