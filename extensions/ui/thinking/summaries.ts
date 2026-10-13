/**
 * thinking/summaries — reasoning-summary extraction.
 *
 * OpenAI's Responses API streams reasoning as a sequence of summary items whose
 * text is a bold title followed by a body. Those titles make far better live
 * labels than a static "Thinking...", so the renderer prefers the latest one
 * while a run streams and the structured `thinkingSignature` once it is
 * complete. Everything here is defensive: provider signatures vary, and a
 * parse failure falls back to the generic label.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SummaryPart } from "./types.ts";

function parseSummaryPart(text: string): SummaryPart | undefined {
	const match = /^\s*\*\*([^\n]+?)\*\*[ \t]*(?:\r?\n(?:\r?\n)?([\s\S]*))?\s*$/.exec(text);
	if (!match) return undefined;
	return { title: match[1].trim(), body: (match[2] ?? "").trim() };
}

/**
 * Extract the last summary heading from streamed thinking text.
 *
 * Providers do not consistently insert a blank line between streamed summary
 * parts, so a bold title at the start of any source line is accepted. The body
 * is everything after the final title.
 */
export function parseLatestStreamingSummary(text: string): SummaryPart | undefined {
	const titlePattern = /(?:^|\r?\n)\s*\*\*([^\n*]+?)\*\*[ \t]*(?:\r?\n)?/g;
	let latest: RegExpExecArray | undefined;
	let match: RegExpExecArray | null;
	while ((match = titlePattern.exec(text))) latest = match;
	if (!latest) return parseSummaryPart(text);

	return {
		title: latest[1].trim(),
		body: text.slice(latest.index + latest[0].length).trim(),
	};
}

/** Whether the message came from an OpenAI Responses-family endpoint. */
export function isOpenAiResponsesMessage(message: AssistantMessage): boolean {
	return (
		message.api === "openai-responses" ||
		message.api === "openai-codex-responses" ||
		message.api === "azure-openai-responses"
	);
}

/** Read the latest summary item out of a structured `thinkingSignature`. */
export function getLatestOpenAiSummary(thinkingSignature: string | undefined): SummaryPart | undefined {
	if (!thinkingSignature) return undefined;

	try {
		const item = JSON.parse(thinkingSignature) as {
			type?: unknown;
			summary?: Array<{ type?: unknown; text?: unknown }>;
		};
		if (item.type !== "reasoning" || !Array.isArray(item.summary)) {
			return undefined;
		}

		for (let index = item.summary.length - 1; index >= 0; index -= 1) {
			const part = item.summary[index];
			if (part.type !== "summary_text" || typeof part.text !== "string") {
				continue;
			}
			const parsed = parseSummaryPart(part.text);
			if (parsed) return parsed;
		}
	} catch {
		// Invalid or provider-specific signatures use the generic fallback.
	}
	return undefined;
}
