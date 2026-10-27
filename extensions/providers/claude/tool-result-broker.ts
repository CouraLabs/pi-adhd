import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export interface SdkToolResult {
	content: (TextContent | ImageContent)[];
	isError: boolean;
}

interface PendingWaiter {
	resolve: (result: SdkToolResult) => void;
	reject: (error: Error) => void;
}

interface ExpectedCall {
	sessionKey: string;
	settled?: SdkToolResult;
	waiter?: PendingWaiter;
}

export class ToolResultBroker {
	private readonly expectedCalls = new Map<string, ExpectedCall>();

	expect(toolUseId: string, sessionKey: string): void {
		if (!this.expectedCalls.has(toolUseId)) this.expectedCalls.set(toolUseId, { sessionKey });
	}

	deliver(toolUseId: string, result: SdkToolResult): void {
		const call = this.expectedCalls.get(toolUseId);
		if (!call) return;
		if (call.waiter) {
			this.expectedCalls.delete(toolUseId);
			call.waiter.resolve(result);
			return;
		}
		call.settled = result;
	}

	wait(toolUseId: string, signal: AbortSignal | undefined): Promise<SdkToolResult> {
		const call = this.expectedCalls.get(toolUseId);
		if (!call) return Promise.reject(new Error(`No active Claude session is running tool call ${toolUseId}`));
		if (call.settled) {
			this.expectedCalls.delete(toolUseId);
			return Promise.resolve(call.settled);
		}
		if (call.waiter) return Promise.reject(new Error(`Tool call ${toolUseId} is already awaited`));
		if (signal?.aborted) return Promise.reject(new Error("Operation aborted"));

		return new Promise<SdkToolResult>((resolve, reject) => {
			const onAbort = (): void => {
				call.waiter = undefined;
				reject(new Error("Operation aborted"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			call.waiter = {
				resolve: (result) => {
					signal?.removeEventListener("abort", onAbort);
					resolve(result);
				},
				reject: (error) => {
					signal?.removeEventListener("abort", onAbort);
					reject(error);
				},
			};
		});
	}

	disposeSession(sessionKey: string, reason: string): void {
		for (const [toolUseId, call] of [...this.expectedCalls]) {
			if (call.sessionKey !== sessionKey) continue;
			this.expectedCalls.delete(toolUseId);
			call.waiter?.reject(new Error(reason));
		}
	}
}

export const toolResultBroker = new ToolResultBroker();
