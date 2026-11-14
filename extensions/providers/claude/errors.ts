import type { SDKAssistantMessageError, SDKMessage, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const AUTH_ERROR_GUIDANCE =
	"Claude is not signed in. Run `claude auth login` in a terminal or set ANTHROPIC_API_KEY. pi never handles Claude credentials.";

const SDK_ERROR_MESSAGES: Partial<Record<SDKAssistantMessageError, string>> = {
	authentication_failed: AUTH_ERROR_GUIDANCE,
	oauth_org_not_allowed: AUTH_ERROR_GUIDANCE,
	account_on_hold: "The Claude account is on hold.",
	billing_error: "Claude reported a billing error for this account. Check your Claude plan and extra-usage settings.",
	rate_limit: "Claude rate limit reached.",
	overloaded: "Claude is overloaded. Try again shortly.",
	model_not_found: "Claude does not recognise this model for the signed-in account.",
};

export function describeAssistantError(error: SDKAssistantMessageError): string {
	return SDK_ERROR_MESSAGES[error] ?? `Claude error: ${error}`;
}

function rewriteLoginHint(text: string): string {
	return text.replaceAll("Please run /login", "Run `claude auth login` in a terminal");
}

function httpStatusOf(result: ResultMessage): number | undefined {
	if (result.subtype !== "success") return undefined;
	const status = result.api_error_status;
	return typeof status === "number" && status >= 400 ? status : undefined;
}

function serverFailure(status: number): string {
	const cause = status === 529 ? "Anthropic is overloaded (529)." : `Anthropic returned HTTP ${status}.`;
	return `${cause} Claude Code exhausted its retries. Try again shortly.`;
}

function limitReached(rejected: SDKRateLimitInfo | undefined): string {
	const window = rejected?.rateLimitType?.replaceAll("_", " ");
	const reset = rejected?.resetsAt ? ` Resets at ${new Date(rejected.resetsAt * 1000).toLocaleString()}.` : "";
	return `Claude subscription limit reached${window ? ` (${window})` : ""}.${reset}`;
}

export function isFailedResult(result: ResultMessage): boolean {
	return result.subtype !== "success" || result.is_error || httpStatusOf(result) !== undefined;
}

export class TurnDiagnostics {
	private assistantError: SDKAssistantMessageError | undefined;
	private rejectedLimit: SDKRateLimitInfo | undefined;

	observe(message: SDKMessage): void {
		if (message.type === "rate_limit_event") {
			this.rejectedLimit = message.rate_limit_info.status === "rejected" ? message.rate_limit_info : undefined;
		}
		if (message.type === "assistant" && message.parent_tool_use_id === null && message.error) {
			this.assistantError = message.error;
		}
	}

	describeFailure(result: ResultMessage): string {
		const status = httpStatusOf(result);
		const limited = this.assistantError === "rate_limit" || (this.rejectedLimit !== undefined && status === 429);
		if (limited) return limitReached(this.rejectedLimit);
		if (status !== undefined && status >= 500) return serverFailure(status);
		if (this.assistantError !== undefined) return describeAssistantError(this.assistantError);
		const detail = rewriteLoginHint(result.subtype === "success" ? result.result : (result.errors ?? []).join("\n")).trim();
		if (detail) return detail;
		if (status !== undefined) return `Claude could not finish its reply (HTTP ${status}).`;
		return `Claude run ended with ${result.subtype}.`;
	}
}
