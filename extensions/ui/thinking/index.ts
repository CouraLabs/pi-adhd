import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantMessageComponent,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
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

				}
			}
			return transformedMarkdown;
		},
	} as unknown as MarkdownOptions;
}

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

	function refreshRenderedComponents(): void {

		for (const ref of renderedComponents) {
			if (!ref.deref()) renderedComponents.delete(ref);
		}

		if (activeTui) {

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

		if (!self.hideThinkingBlock) {
			originalUpdateContent.call(this, message);
			return;
		}

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

		ctx.ui.setWidget(WIDGET_ID, (tui) => {
			activeTui = tui;
			return { render: () => [], invalidate() {} };
		});

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

	});

	pi.on("tool_execution_start", finishThinking);
	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") finishThinking();
	});

	pi.on("session_start", (_event, ctx) => {
		refreshThinkingConfig();
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
}
