import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, Markdown } from "@earendil-works/pi-tui";

export interface SummaryPart {
	title: string;
	body: string;
}

export interface ActiveThinking {
	messageTimestamp: number;
	contentIndex: number;
	startedAt: number;
}

export interface DurationEntryData {
	messageTimestamp: number;
	contentIndex: number;
	durationMs: number;
}

export interface MarkdownTransformContext {
	messageType: string;
	isStreaming: boolean;
	availableWidth: number;
}

export type MarkdownTransformer = (
	markdown: string,
	context: MarkdownTransformContext,
) => string | undefined;

export interface AssistantInternals {
	contentContainer: {
		clear(): void;
		addChild(component: Component): void;
	};
	hideThinkingBlock: boolean;
	markdownTheme: ConstructorParameters<typeof Markdown>[3];
	hiddenThinkingLabel: string;
	outputPad: number;
	isStreaming?: boolean;
	markdownTransformers?: readonly MarkdownTransformer[];
	lastMessage?: AssistantMessage;
	hasToolCalls: boolean;
	updateContent(message: AssistantMessage, isStreaming?: boolean): void;
}

export type PatchedPrototype = typeof AssistantMessageComponent.prototype & {
	updateContent: (message: AssistantMessage, isStreaming?: boolean) => void;
};
