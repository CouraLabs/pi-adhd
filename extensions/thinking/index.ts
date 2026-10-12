/**
 * thinking — a summary view for the model's reasoning.
 *
 * Replaces pi's built-in thinking renderer with a single summary mode: each
 * completed step is classified with a semantic role icon and a short
 * extractive sentence, under a `Reasoning`/`Thoughts` title that reports the
 * elapsed reasoning time. No configuration, no mode switching — installing the
 * extension is the whole setup.
 *
 * Rendering goes through the markdown-transformer hook (no monkeypatch): the
 * native Markdown renderer draws whatever we return, styled as thinking text.
 * While a message streams the transformer appends completed steps
 * incrementally; the full heuristic derivation runs once the block finalizes
 * (and is memoized for later re-renders).
 *
 * Collapsed (hidden) thinking blocks do not go through the transformer, so the
 * `Thinking...` label is driven from the streaming events instead: while a run
 * is streaming, the label shows its latest summary item. Since setting that
 * label makes pi rebuild every assistant message in the transcript, it is only
 * driven while thinking is actually collapsed.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	captureStreamDuration,
	latestStreamingSummary,
	streamingThinkingMarkdown,
	thinkingToMarkdown,
} from "./markdown-render.ts";

interface ThinkingBlockLike {
	type: string;
	thinking?: string;
}

interface ThinkingPartialLike {
	content: ThinkingBlockLike[];
}

/**
 * The contiguous thinking run containing `contentIndex`, joined exactly like
 * pi's assistant-message component (`thinkingBlocks.join("\n\n")`), so the
 * event handler and the markdown transformer share one stream key.
 */
function thinkingRunText(partial: ThinkingPartialLike, contentIndex: number): string | undefined {
	let start = contentIndex;
	while (start > 0 && partial.content[start - 1]?.type === "thinking") start -= 1;
	let end = contentIndex;
	while (end + 1 < partial.content.length && partial.content[end + 1]?.type === "thinking") end += 1;

	const blocks: string[] = [];
	for (let index = start; index <= end; index += 1) {
		const block = partial.content[index];
		if (block?.type === "thinking" && typeof block.thinking === "string") {
			const text = block.thinking.trim();
			if (text) blocks.push(text);
		}
	}
	return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

export default function thinkingExtension(pi: ExtensionAPI): void {
	pi.registerMarkdownTransformer((markdown, context) => {
		if (context.messageType !== "assistant-thinking") return markdown;
		return context.isStreaming ? streamingThinkingMarkdown(markdown) : thinkingToMarkdown(markdown);
	});

	// Collapsed thinking shows the live last summary item instead of a static
	// "Thinking..." label. Updating that label makes pi rebuild every assistant
	// message component in the transcript (discarding all Markdown caches), so it
	// is only worth doing when thinking is actually collapsed — the default is
	// visible, where the transformer already draws the summary. The settings
	// snapshot is refreshed at most once per second because getSettings() clones.
	const LABEL_INTERVAL_MS = 2000;
	const SETTINGS_INTERVAL_MS = 1000;
	let lastLabelAt = 0;
	let lastSettingsAt = 0;
	let thinkingHidden = false;
	let hiddenLabel: string | undefined;

	const refreshThinkingHidden = (): boolean => {
		const now = Date.now();
		if (now - lastSettingsAt >= SETTINGS_INTERVAL_MS) {
			lastSettingsAt = now;
			thinkingHidden = pi.getSettings().hideThinkingBlock === true;
		}
		return thinkingHidden;
	};

	const restoreHiddenLabel = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI || hiddenLabel === undefined) return;
		hiddenLabel = undefined;
		ctx.ui.setHiddenThinkingLabel();
	};

	pi.on("message_update", (event, ctx) => {
		const update = event.assistantMessageEvent;
		if (update.type !== "thinking_delta" && update.type !== "thinking_end") return;

		if (update.type === "thinking_end") {
			const runText = thinkingRunText(update.partial, update.contentIndex);
			if (runText) captureStreamDuration(runText);
			return;
		}

		if (!ctx.hasUI) return;
		// The label is only visible for collapsed thinking; when thinking is
		// visible, setting it rebuilds the whole transcript for nothing.
		if (!refreshThinkingHidden()) {
			restoreHiddenLabel(ctx);
			return;
		}
		const now = Date.now();
		if (now - lastLabelAt < LABEL_INTERVAL_MS) return;
		lastLabelAt = now;

		const runText = thinkingRunText(update.partial, update.contentIndex);
		if (!runText) return;
		const item = latestStreamingSummary(runText);
		if (!item || item === hiddenLabel) return;
		hiddenLabel = item;
		ctx.ui.setHiddenThinkingLabel(item);
	});

	pi.on("message_end", (_event, ctx) => restoreHiddenLabel(ctx));
	pi.on("session_shutdown", (_event, ctx) => restoreHiddenLabel(ctx));
}
