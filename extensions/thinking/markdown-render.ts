/**
 * thinking markdown emitter.
 *
 * Converts raw thinking text into the markdown string the registered
 * transformer returns. The view is always a summary: each completed step is
 * classified with a role icon and a short extractive sentence by the pure
 * heuristic engine in parse.ts — no LLM, no async. A title line reports the
 * elapsed reasoning time (`Reasoning - …` while streaming, `Thoughts - …` once
 * the run finishes).
 *
 * Trade-off vs the removed ThinkingUIComponent (ANSI tree): the native
 * Markdown renderer draws whatever markdown we return, styled as thinking
 * text (dim/italic). The bespoke connector tree (├─└─) and live activity
 * pulse are gone; the summary text + per-step role icons survive.
 */
import { deriveStepCore, splitThinkingIntoStepTexts, type DerivedStepCore } from "./parse.ts";

/** Titles for the reasoning block, swapped when a run finishes. */
const STREAMING_TITLE = "Reasoning";
const FINALIZED_TITLE = "Thoughts";

/**
 * Human-readable duration label:
 * `1-999ms`, then `1-59s`, then `1-59m1-59s`, then `1-nh1-59m1-59s`.
 */
export function formatThinkingDuration(ms: number): string {
	const elapsed = Math.max(1, Math.floor(ms));
	if (elapsed < 1000) return `${elapsed}ms`;
	const totalSeconds = Math.floor(elapsed / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) return `${totalMinutes}m${seconds}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h${minutes}m${seconds}s`;
}

function titleLine(title: string, durationMs: number | undefined): string {
	const heading = `## ${title}`;
	return durationMs === undefined ? heading : `${heading} - ${formatThinkingDuration(durationMs)}`;
}

/** Escape markdown punctuation so extracted summaries render literally. */
function escapeMarkdownText(text: string): string {
	return text.replace(/([\\`*_{}\[\]()#+\-.!|>~<&])/g, "\\$1");
}

/** One line per step: role icon + summary. */
function renderSummaryLine(core: DerivedStepCore): string {
	return `${core.icon} ${escapeMarkdownText(core.summary)}`;
}

function renderSummaries(summaries: DerivedStepCore[]): string {
	return summaries.map(renderSummaryLine).join("\n");
}

/**
 * LRU result cache for finalized runs. The transformer re-runs on every
 * re-render where the cached width changed (e.g. terminal resize) — the
 * thinking text is unchanged, so the result is fully reusable. Keyed by text
 * since the output does not depend on width. Bounded to keep memory in check
 * (each key holds a copy of the thinking text).
 */
const RESULT_CACHE_LIMIT = 50;
const resultCache = new Map<string, string>();

/** LRU of measured durations, so re-deriving an evicted result keeps its time. */
const DURATION_CACHE_LIMIT = 200;
const durationByText = new Map<string, number>();

/** Streaming summarization cadence: at most one derivation pass per second. */
const SUMMARY_INTERVAL_MS = 1000;

/**
 * Incremental state for one thinking run.
 *
 * The transformer is stateless and receives the full thinking text on every
 * render, so a naive live summary re-runs the O(n²) MMR derivation over the
 * whole text each frame — main-thread cost plus a summary that rewrites itself
 * as new candidates arrive. Instead we keep a per-stream cursor: each completed
 * paragraph is summarized exactly once and appended, so the visible list only
 * ever grows. Timing is captured here too so the title can report elapsed time.
 *
 * A stream is matched to incoming text by a cheap head fingerprint (the same
 * thinking run keeps growing, so its first characters are stable) rather than a
 * full-string prefix scan. A small LRU bounds memory across runs.
 */
interface StreamingSummaryState {
	fullText: string;
	/** First `STREAM_KEY_LENGTH` chars of the run, stable as it grows. */
	head: string;
	processedLength: number;
	scannedLength: number;
	summaries: DerivedStepCore[];
	/** Joined summary lines, appended incrementally so renders do not re-join. */
	bodyCache: string;
	/** Full transformed markdown for `outputAdvancedAt`'s tick, reused between ticks. */
	outputCache?: string;
	outputAdvancedAt: number;
	startedAt: number;
	lastChunkAt: number;
	lastAdvancedAt: number;
	finished: boolean;
	touchedAt: number;
}

const STREAM_STATE_LIMIT = 8;
const STREAM_KEY_LENGTH = 96;
let streamStates: StreamingSummaryState[] = [];
let streamClock = 0;

/** End index of the final blank-line run in `text`, or -1 when there is none. */
function lastParagraphBoundary(text: string): number {
	const boundary = /\n[ \t]*\n/g;
	let last = -1;
	let match: RegExpExecArray | null;
	while ((match = boundary.exec(text)) !== null) {
		last = match.index + match[0].length;
	}
	return last;
}

/** Index where the trailing whitespace run begins (so it is rescanned next time). */
function trailingWhitespaceStart(text: string): number {
	let index = text.length;
	while (index > 0) {
		const code = text.charCodeAt(index - 1);
		if (code === 32 || code === 9 || code === 10 || code === 13) index -= 1;
		else break;
	}
	return index;
}

/**
 * The state whose run is the longest prefix of `markdown`.
 *
 * Matching is done on the first `STREAM_KEY_LENGTH` chars only: the head of a
 * run is stable while it grows, so this avoids comparing the full accumulated
 * text (which grows unbounded and would be scanned on every render).
 */
function findStreamState(markdown: string): StreamingSummaryState | undefined {
	const head = markdown.slice(0, STREAM_KEY_LENGTH);
	let best: StreamingSummaryState | undefined;
	for (const state of streamStates) {
		if (state.fullText.length > markdown.length) continue;
		if (!head.startsWith(state.head)) continue;
		if (!best || state.fullText.length > best.fullText.length) best = state;
	}
	return best;
}

function createStreamState(markdown: string): StreamingSummaryState {
	const now = Date.now();
	const state: StreamingSummaryState = {
		fullText: markdown,
		head: markdown.slice(0, STREAM_KEY_LENGTH),
		processedLength: 0,
		scannedLength: 0,
		summaries: [],
		bodyCache: "",
		outputAdvancedAt: -1,
		startedAt: now,
		lastChunkAt: now,
		lastAdvancedAt: 0,
		finished: false,
		touchedAt: ++streamClock,
	};
	streamStates.push(state);
	if (streamStates.length > STREAM_STATE_LIMIT) {
		streamStates.sort((left, right) => left.touchedAt - right.touchedAt);
		streamStates = streamStates.slice(streamStates.length - STREAM_STATE_LIMIT);
	}
	return state;
}

function ensureStreamState(markdown: string): StreamingSummaryState {
	const state = findStreamState(markdown) ?? createStreamState(markdown);
	const now = Date.now();
	state.fullText = markdown;
	state.scannedLength = Math.min(state.scannedLength, markdown.length);
	if (!state.finished) state.lastChunkAt = now;
	state.touchedAt = ++streamClock;
	// The O(n²) derivation is the expensive part of a streaming render, so it
	// runs on a one-second cadence rather than on every chunk/frame. Between
	// ticks the previous summaries are returned unchanged; the finalize path
	// does one last full pass.
	if (now - state.lastAdvancedAt >= SUMMARY_INTERVAL_MS) {
		state.lastAdvancedAt = now;
		advanceStreamState(state);
	}
	return state;
}

function takeStreamState(markdown: string): StreamingSummaryState | undefined {
	const state = findStreamState(markdown);
	if (!state) return undefined;
	streamStates = streamStates.filter((candidate) => candidate !== state);
	return state;
}

/**
 * Summarize paragraphs completed since the last call, appending the results.
 * Only the text appended since the previous scan is inspected, so the whole
 * run is never re-parsed.
 */
function advanceStreamState(state: StreamingSummaryState): void {
	const scanStart = Math.max(state.processedLength, Math.min(state.scannedLength, state.fullText.length));
	const boundaryOffset = lastParagraphBoundary(state.fullText.slice(scanStart));
	if (boundaryOffset >= 0) {
		const boundary = scanStart + boundaryOffset;
		const completed = state.fullText.slice(state.processedLength, boundary);
		state.processedLength = boundary;
		for (const step of splitThinkingIntoStepTexts(completed)) {
			const core = deriveStepCore(step);
			state.summaries.push(core);
			const line = renderSummaryLine(core);
			state.bodyCache = state.bodyCache.length === 0 ? line : `${state.bodyCache}\n${line}`;
		}
	}
	// Rescan from the trailing whitespace so a `\n\n` split across two chunks is
	// still seen as one boundary.
	state.scannedLength = trailingWhitespaceStart(state.fullText);
}

function rememberDuration(text: string, duration: number): void {
	durationByText.delete(text);
	durationByText.set(text, duration);
	if (durationByText.size > DURATION_CACHE_LIMIT) {
		const oldest = durationByText.keys().next().value;
		if (oldest !== undefined) durationByText.delete(oldest);
	}
}

/**
 * Mark a run as finished and freeze its duration. Called from the
 * `thinking_end` event so the block switches from `Reasoning` to `Thoughts`
 * as soon as its thinking stops, even while the rest of the message streams.
 */
export function captureStreamDuration(markdown: string): void {
	const state = findStreamState(markdown);
	if (!state || state.finished) return;
	state.finished = true;
	state.lastChunkAt = Date.now();
	rememberDuration(markdown, state.lastChunkAt - state.startedAt);
}

/** Last completed-step summary line, for the collapsed thinking label. */
export function latestStreamingSummary(markdown: string): string | undefined {
	const state = ensureStreamState(markdown);
	const last = state.summaries[state.summaries.length - 1];
	return last ? `${last.icon} ${last.summary}` : undefined;
}

function refreshResultCache(key: string, value: string): void {
	resultCache.delete(key);
	resultCache.set(key, value);
}

function storeResult(key: string, value: string): void {
	resultCache.set(key, value);
	if (resultCache.size > RESULT_CACHE_LIMIT) {
		const oldest = resultCache.keys().next().value;
		if (oldest !== undefined) resultCache.delete(oldest);
	}
}

function renderFinalized(markdown: string, duration: number | undefined): string {
	const cached = resultCache.get(markdown);
	if (cached !== undefined) {
		refreshResultCache(markdown, cached);
		return cached;
	}
	const result = computeThinkingToMarkdown(markdown, duration);
	storeResult(markdown, result);
	return result;
}

/**
 * View while the assistant message is still streaming.
 *
 * Until the run finishes: an incremental, append-only list of completed-step
 * summaries under a live `Reasoning - <elapsed>` title, falling back to the raw
 * stream until the first paragraph completes. Once `captureStreamDuration`
 * marks the run finished, it renders the finalized `Thoughts - <duration>`
 * view (including the last paragraph) and memoizes it, so later renders while
 * the rest of the message streams are free. The transformer must stay
 * "synchronous and inexpensive" (pi docs) and runs on every streaming chunk.
 */
export function streamingThinkingMarkdown(markdown: string): string {
	const cached = resultCache.get(markdown);
	if (cached !== undefined) {
		refreshResultCache(markdown, cached);
		return cached;
	}

	const state = ensureStreamState(markdown);
	if (state.finished) {
		const duration = state.lastChunkAt - state.startedAt;
		rememberDuration(markdown, duration);
		takeStreamState(markdown);
		return renderFinalized(markdown, duration);
	}

	if (state.summaries.length === 0) {
		// No completed step yet: fall back to the raw stream. The body changes
		// every chunk, so there is nothing to cache.
		return `${titleLine(STREAMING_TITLE, state.lastAdvancedAt - state.startedAt)}\n${markdown}`;
	}

	// Use the tick time, not `Date.now()`: a live ms clock would change the
	// markdown every frame and force a re-lex/re-render. The title advances on
	// the same one-second cadence as the summaries, so between ticks the whole
	// transformed output is reused verbatim.
	if (state.outputCache !== undefined && state.outputAdvancedAt === state.lastAdvancedAt) {
		return state.outputCache;
	}
	state.outputCache = `${titleLine(STREAMING_TITLE, state.lastAdvancedAt - state.startedAt)}\n${state.bodyCache}`;
	state.outputAdvancedAt = state.lastAdvancedAt;
	return state.outputCache;
}

/**
 * Transform a finalized run of thinking markdown: a `Thoughts - <duration>`
 * title followed by one line per derived step (icon + summary). Memoized per
 * text — the expensive MMR derivation is not re-run for unchanged text across
 * re-renders (resize, restore, …).
 */
export function thinkingToMarkdown(markdown: string): string {
	const cached = resultCache.get(markdown);
	if (cached !== undefined) {
		refreshResultCache(markdown, cached);
		return cached;
	}

	const state = takeStreamState(markdown);
	const duration = state ? state.lastChunkAt - state.startedAt : durationByText.get(markdown);
	if (duration !== undefined) rememberDuration(markdown, duration);
	return renderFinalized(markdown, duration);
}

function computeThinkingToMarkdown(markdown: string, duration: number | undefined): string {
	const title = titleLine(FINALIZED_TITLE, duration);
	const text = markdown.trim();
	if (!text) return title;

	const steps = splitThinkingIntoStepTexts(text);
	const body =
		steps.length === 0
			? renderSummaries([deriveStepCore(text)])
			: renderSummaries(steps.map((step) => deriveStepCore(step)));
	return `${title}\n${body}`;
}
