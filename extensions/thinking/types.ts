/**
 * thinking — shared types for the compact reasoning preview.
 *
 * The renderer patches pi's internal `AssistantMessageComponent` (the extension
 * is a vendored, pi-pack-adapted port of `pi-compact-thinking`), so the
 * internals it touches are typed structurally here rather than through the
 * public API. Keeping them in one place makes the surface easy to audit when
 * pi's component changes.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, Markdown } from "@earendil-works/pi-tui";

/** A structured reasoning-summary heading plus its preview body. */
export interface SummaryPart {
	title: string;
	body: string;
}

/** The reasoning run currently streaming, keyed by message and content index. */
export interface ActiveThinking {
	messageTimestamp: number;
	contentIndex: number;
	startedAt: number;
}

/** Persisted per-run reasoning duration, appended as a custom session entry. */
export interface DurationEntryData {
	messageTimestamp: number;
	contentIndex: number;
	durationMs: number;
}

/** Context passed to pi's markdown transformers. */
export interface MarkdownTransformContext {
	messageType: string;
	isStreaming: boolean;
	availableWidth: number;
}

export type MarkdownTransformer = (
	markdown: string,
	context: MarkdownTransformContext,
) => string | undefined;

/**
 * The private fields and methods of `AssistantMessageComponent` the patched
 * `updateContent` reads. `contentContainer` and `updateContent` are inherited
 * from `Container`; the rest are component-private.
 */
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

/** The patchable shape of the assistant-message prototype. */
export type PatchedPrototype = typeof AssistantMessageComponent.prototype & {
	updateContent: (message: AssistantMessage, isStreaming?: boolean) => void;
};
