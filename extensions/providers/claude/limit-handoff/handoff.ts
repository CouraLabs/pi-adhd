import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatTimeUntilReset } from "../../../../shared/rate-limits.ts";
import { CLAUDE_PROVIDER_ID } from "../../../../shared/modes.ts";
import { loadHandoffModelId } from "./config.ts";
import { buildContinuationPrompt } from "./continuation.ts";
import { takeLimitHit } from "./pending-limit.ts";
import type { LimitHit } from "./pending-limit.ts";

const FALLBACK_WAIT_MS = 5 * 60_000;
const MAX_TIMER_MS = 2 ** 31 - 1;

function notify(context: ExtensionContext, text: string): void {
	if (context.hasUI) context.ui.notify(text, "warning");
	else console.error(text);
}

function splitModelId(modelId: string): { provider: string; id: string } | undefined {
	const separator = modelId.indexOf("/");
	return separator > 0 ? { provider: modelId.slice(0, separator), id: modelId.slice(separator + 1) } : undefined;
}

async function handOffToModel(pi: ExtensionAPI, context: ExtensionContext, modelId: string, hit: LimitHit): Promise<boolean> {
	const parts = splitModelId(modelId);
	const model = parts ? context.modelRegistry.find(parts.provider, parts.id) : undefined;
	if (!model || model.provider === CLAUDE_PROVIDER_ID) {
		notify(context, `Limit handoff model ${modelId} is not available; waiting for the Claude limit to reset instead.`);
		return false;
	}
	if (!(await pi.setModel(model))) {
		notify(context, `No credentials for ${modelId}; waiting for the Claude limit to reset instead.`);
		return false;
	}
	notify(context, `Claude limit reached — handed off to ${modelId}.`);
	pi.sendUserMessage(buildContinuationPrompt(hit.interruptedAgents, true));
	return true;
}

export function createLimitHandoff(pi: ExtensionAPI): {
	handleSettled(context: ExtensionContext): Promise<void>;
	cancelWait(): void;
} {
	let waitTimer: ReturnType<typeof setTimeout> | undefined;

	const cancelWait = (): void => {
		if (waitTimer !== undefined) clearTimeout(waitTimer);
		waitTimer = undefined;
	};

	const waitForReset = (context: ExtensionContext, hit: LimitHit): void => {
		const delay = Math.min(hit.resetsAt === undefined ? FALLBACK_WAIT_MS : Math.max(hit.resetsAt - Date.now(), 0), MAX_TIMER_MS);
		const remaining = hit.resetsAt === undefined ? undefined : formatTimeUntilReset(hit.resetsAt);
		notify(context, `Claude limit reached — continuing automatically ${remaining ? `in ${remaining}` : "in 5m"}.`);
		cancelWait();
		waitTimer = setTimeout(() => {
			waitTimer = undefined;
			pi.sendUserMessage(buildContinuationPrompt(hit.interruptedAgents, false));
		}, delay);
	};

	const handleSettled = async (context: ExtensionContext): Promise<void> => {
		const hit = takeLimitHit(context.sessionManager.getSessionId());
		if (!hit || context.model?.provider !== CLAUDE_PROVIDER_ID) return;
		const modelId = loadHandoffModelId();
		if (modelId && (await handOffToModel(pi, context, modelId, hit))) return;
		waitForReset(context, hit);
	};

	return { handleSettled, cancelWait };
}
