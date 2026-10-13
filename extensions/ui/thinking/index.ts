/**
 * thinking — compact animated reasoning previews.
 *
 * A vendored, pi-tdah-adapted port of `pi-compact-thinking` (MIT). It replaces
 * pi's built-in hidden-thinking renderer with a single compact run: an animated
 * heading (the OpenAI summary title, or `Thinking...`), the elapsed time, and a
 * few preview lines. Visible mode is left exactly as pi renders it, so
 * `Shift+Tab` still expands the full reasoning block.
 *
 * The upstream extension patches `AssistantMessageComponent.prototype.updateContent`
 * — pi exposes no hook for the hidden-thinking body — and that internal API is
 * why the port keeps its touch surface in `types.ts`. The patch is installed on
 * `session_start`, removed on `session_shutdown`, and can be toggled at runtime
 * with `/thinking-ui [on|off]`.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import { updateSettings } from "../../../shared/settings.ts";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { refreshThinkingConfig, thinkingConfig } from "./config.ts";
import { DURATION_ENTRY_TYPE, restoreDurationEntries } from "./durations.ts";
import { formatThoughtDuration, StrictThinkingPreview } from "./preview.ts";
import {
	getLatestOpenAiSummary,
	isOpenAiResponsesMessage,
	parseLatestStreamingSummary,
} from "./summaries.ts";
import type {
	ActiveThinking,
	AssistantInternals,
	DurationEntryData,
	MarkdownTransformer,
	PatchedPrototype,
	SummaryPart,
} from "./types.ts";

const WIDGET_ID = "compact-thinking-render-loop";
type MarkdownOptions = NonNullable<ConstructorParameters<typeof Markdown>[5]>;

/**
 * Rebuild the markdown-transform options pi normally passes for assistant text.
 *
 * `markdownTransformers` and Markdown's `transform` option are internal APIs,
 * so this is written to degrade to `undefined` when pi predates the transformer
 * pipeline instead of failing the render.
 */
function getAssistantMarkdownOptions(
	self: AssistantInternals,
	isStreaming: boolean,
): MarkdownOptions | undefined {
	const transformers = self.markdownTransformers;
	if (!transformers || transformers.length === 0) return undefined;

	return {
		transform(markdown: string, availableWidth: number) {
			let transformedMarkdown = markdown;
			for (const transformer of transformers) {
				try {
					const transformed = transformer(transformedMarkdown, {
						messageType: "assistant",
						isStreaming,
						availableWidth,
					} satisfies Parameters<MarkdownTransformer>[1]);
					if (typeof transformed === "string") {
						transformedMarkdown = transformed;
					}
				} catch {
					// Match pi: one broken transformer must not stop the rest.
				}
			}
			return transformedMarkdown;
		},
	} as unknown as MarkdownOptions;
}

/** True when a content block renders something a reader can actually see. */
function isVisibleContent(content: AssistantMessage["content"][number]): boolean {
	return (
		(content.type === "text" && content.text.trim() !== "") ||
		(content.type === "thinking" && content.thinking.trim() !== "")
	);
}

export default function thinkingExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("thinking");
	const prototype = AssistantMessageComponent.prototype as PatchedPrototype;
	const originalUpdateContent = prototype.updateContent;

	const completedDurations = new Map<number, Map<number, number>>();
	// Weak refs: pi drops assistant components when a message is compacted or
	// removed from the tree, and this set must not keep them (and their message
	// payloads) alive for the rest of the session. `trackedComponents` dedupes
	// because each `new WeakRef` is a distinct object and pi calls updateContent
	// on every streaming delta.
	const renderedComponents = new Set<WeakRef<AssistantMessageComponent>>();
	const trackedComponents = new WeakSet<AssistantMessageComponent>();
	const streamingComponents = new Set<AssistantMessageComponent>();
	let activeThinking: ActiveThinking | undefined;
	let activeTheme: Theme | undefined;
	let activeTui: TUI | undefined;
	let latestComponent: AssistantMessageComponent | undefined;
	let latestComponentTimestamp: number | undefined;
	let animationTimer: ReturnType<typeof setInterval> | undefined;
	let animationFrame = 0;
	let patchInstalled = false;

	/** Force every tracked assistant message to re-render through the patch. */
	function refreshRenderedComponents(): void {
		// Prune components pi has already discarded before touching the rest.
		for (const ref of renderedComponents) {
			if (!ref.deref()) renderedComponents.delete(ref);
		}

		if (activeTui) {
			// A resumed session renders before extensions rebind. Invalidate the
			// tree so those prebuilt components run updateContent again.
			activeTui.invalidate();
			activeTui.requestRender(true);
			return;
		}

		for (const ref of renderedComponents) {
			const component = ref.deref();
			if (!component) continue;
			const self = component as unknown as AssistantInternals;
			if (self.lastMessage) self.updateContent(self.lastMessage);
		}
	}

	function thinkingStyle(text: string): string {
		return activeTheme ? activeTheme.italic(activeTheme.fg("thinkingText", text)) : text;
	}

	function summaryTitleStyle(text: string): string {
		return activeTheme
			? activeTheme.italic(activeTheme.bold(activeTheme.fg("warning", text)))
			: text;
	}

	/** Sweep a bright highlight across `text` to signal an active run. */
	function animatedText(
		text: string,
		baseStyle: (value: string) => string,
		animate: boolean,
	): string {
		if (!animate || !activeTheme) return baseStyle(text);

		const characters = Array.from(text);
		if (characters.length === 0) return "";
		const highlightWidth = Math.max(1, Math.min(5, Math.ceil(characters.length * 0.28)));
		const start = (animationFrame % (characters.length + highlightWidth)) - highlightWidth;
		const end = start + highlightWidth;
		const before = characters.slice(0, Math.max(0, start)).join("");
		const highlighted = characters
			.slice(Math.max(0, start), Math.min(characters.length, end))
			.join("");
		const after = characters.slice(Math.max(0, end)).join("");

		return (
			baseStyle(before) + 
			(highlighted ? activeTheme.italic(activeTheme.bold(activeTheme.fg("text", highlighted))) : "") + 
			baseStyle(after)
		);
	}

	/** The most recent completed duration in a run, used after the run ends. */
	function getCompletedDuration(
		messageTimestamp: number,
		startIndex: number,
		endIndex: number,
	): number | undefined {
		const durations = completedDurations.get(messageTimestamp);
		if (!durations) return undefined;
		for (let index = endIndex; index >= startIndex; index -= 1) {
			const duration = durations.get(index);
			if (duration !== undefined) return duration;
		}
		return undefined;
	}

	function isActiveRun(message: AssistantMessage, startIndex: number, endIndex: number): boolean {
		return (
			activeThinking?.messageTimestamp === message.timestamp &&
			activeThinking.contentIndex >= startIndex &&
			activeThinking.contentIndex <= endIndex
		);
	}

	/**
	 * The patched `updateContent`. Visible thinking falls straight through to
	 * pi's original renderer; only hidden thinking is replaced.
	 */
	function patchedUpdateContent(
		this: AssistantMessageComponent,
		message: AssistantMessage,
		isStreaming?: boolean,
	): void {
		const component = this as AssistantMessageComponent;
		const self = this as unknown as AssistantInternals;
		const currentIsStreaming = isStreaming ?? self.isStreaming ?? false;
		self.isStreaming = currentIsStreaming;
		self.lastMessage = message;
		latestComponent = component;
		latestComponentTimestamp = message.timestamp;

		// Visible mode is intentionally untouched: Shift+Tab restores pi's exact
		// built-in Thinking Markdown renderer, including every OpenAI summary stage.
		if (!self.hideThinkingBlock) {
			originalUpdateContent.call(this, message);
			return;
		}

		// Only hidden renders depend on this extension's state (durations, theme,
		// animation), so only they need tracking for a forced re-render.
		if (!trackedComponents.has(component)) {
			trackedComponents.add(component);
			renderedComponents.add(new WeakRef(component));
		}

		if (activeThinking?.messageTimestamp === message.timestamp) {
			streamingComponents.add(component);
		}

		self.contentContainer.clear();
		const hasActiveThinking =
			activeThinking?.messageTimestamp === message.timestamp &&
			message.content.some((content) => content.type === "thinking");
		const hasVisibleContent = hasActiveThinking || message.content.some(isVisibleContent);
		// Reserve pi's normal leading spacer even before the first token, so the
		// heading does not jump down a row once content starts streaming.
		if (hasVisibleContent) self.contentContainer.addChild(new Spacer(1));

		for (let index = 0; index < message.content.length; index += 1) {
			const content = message.content[index];

			if (content.type === "text" && content.text.trim()) {
				self.contentContainer.addChild(
					new Markdown(
						content.text.trim(),
						self.outputPad,
						0,
						self.markdownTheme,
						undefined,
						getAssistantMarkdownOptions(self, currentIsStreaming),
					),
				);
				continue;
			}

			if (content.type !== "thinking") continue;

			const runStartIndex = index;
			const hasVisibleContentBefore = message.content
				.slice(0, runStartIndex)
				.some(isVisibleContent);
			const thinkingBlocks: string[] = [];
			let latestSummary: SummaryPart | undefined;
			for (; index < message.content.length; index += 1) {
				const thinkingContent = message.content[index];
				if (thinkingContent.type !== "thinking") break;
				const thinking = thinkingContent.thinking.trim();
				if (!thinking) continue;
				thinkingBlocks.push(thinking);

				if (thinkingConfig().useSummaryTitlesAsThinkingTitle && isOpenAiResponsesMessage(message)) {
					const contentIsActive =
						activeThinking?.messageTimestamp === message.timestamp &&
						activeThinking.contentIndex === index;
					latestSummary = contentIsActive
						? parseLatestStreamingSummary(thinking) ??
							getLatestOpenAiSummary(thinkingContent.thinkingSignature) ??
							latestSummary
						: getLatestOpenAiSummary(thinkingContent.thinkingSignature) ??
							parseLatestStreamingSummary(thinking) ??
							latestSummary;
				}
			}
			const runEndIndex = index - 1;
			index -= 1;
			const active = isActiveRun(message, runStartIndex, runEndIndex);
			// OpenAI can spend seconds reasoning before the first summary token.
			// Keep an empty active block visible as animated "Thinking..." so that
			// silent interval still shows progress.
			if (thinkingBlocks.length === 0 && !active) continue;
			if (hasVisibleContentBefore) {
				self.contentContainer.addChild(new Spacer(1));
			}

			const elapsedMs = activeThinking
				? Math.max(1, Date.now() - activeThinking.startedAt)
				: undefined;
			const completedMs = getCompletedDuration(message.timestamp, runStartIndex, runEndIndex);
			const durationMs = active ? elapsedMs : completedMs;
			const durationText =
				durationMs === undefined ? undefined : formatThoughtDuration(durationMs);

			let heading: string;
			if (active && latestSummary) {
				heading =
					animatedText(latestSummary.title, summaryTitleStyle, true) +
					(durationText ? summaryTitleStyle(` · ${durationText}`) : "");
			} else if (active) {
				const label = "Reasoning";
				heading = animatedText(label, summaryTitleStyle, true) +
					(durationText ? summaryTitleStyle(` · ${durationText}`) : "");
			} else {
				// Completed compact blocks use one provider-independent status line.
				heading = summaryTitleStyle(
					durationText ? `Thought for ${durationText}` : "Reasoning",
				);
			}
			const previewSource = latestSummary?.body ?? thinkingBlocks.join("\n\n");
			if (thinkingConfig().previewLines > 0 && previewSource.trim()) {
				self.contentContainer.addChild(
					new StrictThinkingPreview(heading, previewSource.trim(), self.outputPad, thinkingStyle),
				);
			} else {
				self.contentContainer.addChild(new Text(heading, self.outputPad, 0));
			}

			const hasVisibleContentAfter = message.content
				.slice(index + 1)
				.some(isVisibleContent);
			if (hasVisibleContentAfter) self.contentContainer.addChild(new Spacer(1));
		}

		const hasToolCalls = message.content.some((content) => content.type === "toolCall");
		self.hasToolCalls = hasToolCalls;

		if (message.stopReason === "length") {
			self.contentContainer.addChild(new Spacer(1));
			self.contentContainer.addChild(
				new Text(
					activeTheme
						? activeTheme.fg(
								"error",
								"Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
							)
						: "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
					self.outputPad,
					0,
				),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				self.contentContainer.addChild(new Spacer(1));
				self.contentContainer.addChild(
					new Text(activeTheme ? activeTheme.fg("error", abortMessage) : abortMessage, self.outputPad, 0),
				);
			} else if (message.stopReason === "error") {
				const errorMessage = message.errorMessage || "Unknown error";
				self.contentContainer.addChild(new Spacer(1));
				self.contentContainer.addChild(
					new Text(
						activeTheme ? activeTheme.fg("error", `Error: ${errorMessage}`) : `Error: ${errorMessage}`,
						self.outputPad,
						0,
					),
				);
			}
		}
	}

	function startThinking(message: AssistantMessage, contentIndex: number): void {
		activeThinking = {
			messageTimestamp: message.timestamp,
			contentIndex,
			startedAt: Date.now(),
		};
		streamingComponents.clear();
		animationFrame = 0;

		// Depending on listener order, pi may have rendered the empty
		// thinking_start partial just before this extension sees the event.
		// Re-render it now so the animation appears with the first token.
		if (latestComponent && latestComponentTimestamp === message.timestamp) {
			streamingComponents.add(latestComponent);
			const self = latestComponent as unknown as AssistantInternals;
			self.updateContent(message);
			activeTui?.requestRender();
		}

		if (animationTimer) clearInterval(animationTimer);
		animationTimer = setInterval(() => {
			animationFrame += 1;
			for (const component of streamingComponents) {
				const self = component as unknown as AssistantInternals;
				if (self.lastMessage) self.updateContent(self.lastMessage);
			}
			activeTui?.requestRender();
		}, thinkingConfig().animationIntervalMs);
	}

	function finishThinking(): void {
		if (!activeThinking) return;
		const finished = activeThinking;
		const durationMs = Math.max(1, Date.now() - finished.startedAt);
		let durations = completedDurations.get(finished.messageTimestamp);
		if (!durations) {
			durations = new Map();
			completedDurations.set(finished.messageTimestamp, durations);
		}
		durations.set(finished.contentIndex, durationMs);
		pi.appendEntry<DurationEntryData>(DURATION_ENTRY_TYPE, {
			messageTimestamp: finished.messageTimestamp,
			contentIndex: finished.contentIndex,
			durationMs,
		});

		activeThinking = undefined;
		if (animationTimer) clearInterval(animationTimer);
		animationTimer = undefined;

		const components = [...streamingComponents];
		streamingComponents.clear();
		for (const component of components) {
			const self = component as unknown as AssistantInternals;
			if (self.lastMessage) self.updateContent(self.lastMessage);
		}
		activeTui?.requestRender();
	}

	function install(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || patchInstalled) return;
		prototype.updateContent = patchedUpdateContent;
		patchInstalled = true;
		restoreDurationEntries(ctx.sessionManager.getBranch(), completedDurations);
		activeTheme = ctx.ui.theme;

		// An empty widget gives the animation loop requestRender access without
		// enabling terminal mouse reporting or intercepting native scrollback.
		ctx.ui.setWidget(WIDGET_ID, (tui) => {
			activeTui = tui;
			return { render: () => [], invalidate() {} };
		});

		// On resume, pi may construct the chat before session_start is emitted.
		// Rebuild those already-rendered components now that durations and the
		// active theme are available.
		refreshRenderedComponents();
	}

	function uninstall(ctx: ExtensionContext): void {
		finishThinking();
		if (animationTimer) clearInterval(animationTimer);
		animationTimer = undefined;
		activeTui = undefined;
		activeTheme = undefined;
		latestComponent = undefined;
		latestComponentTimestamp = undefined;
		completedDurations.clear();
		renderedComponents.clear();
		streamingComponents.clear();
		if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_ID, undefined);

		if (patchInstalled) {
			prototype.updateContent = originalUpdateContent;
			patchInstalled = false;
		}
	}

	pi.on("message_update", (event) => {
		if (!patchInstalled || event.message.role !== "assistant") return;
		const update = event.assistantMessageEvent;

		if (update.type === "thinking_start") {
			if (activeThinking?.messageTimestamp === event.message.timestamp) {
				// Some Responses-compatible providers emit a fresh thinking_start
				// for each summary item without a text/tool boundary ending the
				// visible run. Follow the new block, keeping the original start time.
				activeThinking.contentIndex = update.contentIndex;
			} else {
				if (activeThinking) finishThinking();
				startThinking(event.message, update.contentIndex);
			}
		} else if (update.type === "thinking_delta") {
			if (!activeThinking) {
				startThinking(event.message, update.contentIndex);
			} else if (activeThinking.messageTimestamp === event.message.timestamp) {
				activeThinking.contentIndex = update.contentIndex;
			}
		} else if (
			update.type === "text_start" ||
			update.type === "toolcall_start" ||
			update.type === "toolcall_delta"
		) {
			finishThinking();
		}
		// Do not finalize on thinking_end alone: OpenAI Responses providers can
		// close one reasoning item and immediately open another while pi still
		// renders both as one contiguous run. A text/tool transition or message_end
		// is the real visible boundary.
	});

	// OpenAI-compatible providers may not close reasoning until the response ends.
	pi.on("tool_execution_start", finishThinking);
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") finishThinking();
	});

	pi.on("session_start", (_event, ctx) => {
		if (!refreshThinkingConfig().enabled) return;
		install(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		if (!patchInstalled) return;
		restoreDurationEntries(ctx.sessionManager.getBranch(), completedDurations);
		refreshRenderedComponents();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		uninstall(ctx);
	});

	pi.registerCommand("thinking-ui", {
		description:
			"Toggle the Coura Labs compact thinking preview (usage: /thinking-ui [on|off])",
		handler: async (args, commandCtx) => {
			const arg = args.trim().toLowerCase();
			const enabled = arg === "on" ? true : arg === "off" ? false : !thinkingConfig().enabled;

			updateSettings({ thinking: { enabled } });
			refreshThinkingConfig();
			if (enabled) install(commandCtx);
			else uninstall(commandCtx);

			commandCtx.ui.notify(
				enabled ? "Compact thinking enabled" : "Default thinking renderer restored",
				"info",
			);
		},
	});
}
