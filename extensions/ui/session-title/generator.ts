/**
 * generator — turns one user prompt into a session title.
 *
 * The title comes from a single one-shot completion: a system prompt that asks
 * for a short, bare title, and the (truncated) user prompt as the only user
 * message. The completion goes through the model registry so request-time
 * authentication — API keys and OAuth alike — is resolved the same way pi
 * resolves it for the main conversation.
 *
 * Every failure path falls back to a mechanical title (the prompt's first
 * line, compacted and capped) so a naming failure never blocks or notifies:
 * the worst case is a plainer title, never an error in the session.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const TITLE_SYSTEM_PROMPT = [
	"You name coding-agent sessions.",
	"From the user's prompt, write a short session title of 2 to 6 words that names the task or topic.",
	"Reply with the title only: no quotes, no trailing punctuation, no explanation.",
].join(" ");

/** Prompts longer than this are truncated before they reach the naming call. */
const MAX_PROMPT_CHARS = 4_000;
/** Titles longer than this are cut; room for an ellipsis is reserved. */
const MAX_TITLE_CHARS = 60;

/** Resolve the model that writes titles: the stored override when it resolves
 *  to an auth-configured model, otherwise the session's current model. */
export function resolveTitleModel(
	registry: ModelRegistry,
	stored: string | undefined,
	current: Model<any> | undefined,
): Model<any> | undefined {
	if (stored) {
		const slash = stored.indexOf("/");
		if (slash > 0) {
			const found = registry.find(stored.slice(0, slash), stored.slice(slash + 1));
			if (found && registry.hasConfiguredAuth(found)) return found;
		}
	}
	return current && registry.hasConfiguredAuth(current) ? current : undefined;
}

/** The mechanical fallback title: the prompt's first line, compacted and capped. */
export function fallbackTitle(prompt: string): string {
	return compactTitle(prompt.split(/\r?\n/, 1)[0] ?? "");
}

/** Ask `model` for a title. Never rejects; falls back to the prompt's first line. */
export async function generateSessionTitle(
	model: Model<any>,
	registry: ModelRegistry,
	prompt: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	const trimmed = prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}…` : prompt;
	try {
		const message = await registry.complete(
			model,
			{
				systemPrompt: TITLE_SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						timestamp: Date.now(),
						content: [{ type: "text", text: `Name this session. The user's prompt:\n\n${trimmed}` }],
					},
				],
			},
			{ maxTokens: 512, temperature: 0.3, signal },
		);
		if (message.stopReason === "aborted") return undefined;
		const text = message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join(" ");
		return sanitizeTitle(text) ?? fallbackTitle(prompt);
	} catch {
		// Abort bubbles here too; an aborted naming run must not rename the session.
		if (signal.aborted) return undefined;
		return fallbackTitle(prompt);
	}
}

/** Strip quotes, trailing punctuation, and newlines; cap the length. */
function sanitizeTitle(raw: string): string | undefined {
	const title = compactTitle(raw).replace(/^["'`“”]+|["'`“”]+$/g, "").replace(/[.。]+$/, "").trim();
	return title.length > 0 ? title : undefined;
}

/** Flatten to one line of single-spaced text, capped with an ellipsis. */
function compactTitle(raw: string): string {
	const text = raw.trim().replace(/\s+/g, " ");
	if (text.length <= MAX_TITLE_CHARS) return text;
	return `${text.slice(0, MAX_TITLE_CHARS - 1)}…`;
}
