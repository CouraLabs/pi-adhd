import { createGlobalStore } from "../../../shared/store.ts";

export const OPENCODE_FREE_ID = "opencode-free";

export const OPENCODE_GO_ID = "opencode-go";

export const OPENCODE_INFERENCE_BASE_URL = "https://opencode.ai/inference/v1";

export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export const OPENCODE_CATALOG_URL = "https://opencode.ai/inference/v1/models";

export const OPENCODE_ANONYMOUS_KEY = "public";

export const OPENCODE_CLIENT_VERSION = "opencode/latest/2.2.5/opencode";

export const OPENCODE_ENV_ENVELOPE = "<env>Working directory: .</env>";

export const OPENCODE_GATE_TOOLS = ["glob", "grep"] as const;

const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const sessionStore = createGlobalStore<string>(Symbol.for("@couralabs/pi-adhd/opencode-session"), "");

let lastTimestamp = 0;

let ulidCounter = 0;

function nextUlid(descending: boolean): string {
	const timestamp = Date.now();
	if (timestamp !== lastTimestamp) {
		lastTimestamp = timestamp;
		ulidCounter = 0;
	}
	ulidCounter += 1;
	const current = BigInt(timestamp) * 0x1000n + BigInt(ulidCounter);
	const value = descending ? ~current : current;
	const time = Array.from({ length: 6 }, (_, index) =>
		Number((value >> BigInt(40 - 8 * index)) & 0xffn)
			.toString(16)
			.padStart(2, "0"),
	).join("");
	const bytes = crypto.getRandomValues(new Uint8Array(14));
	return time + Array.from(bytes, (byte) => ID_CHARS[byte % 62]).join("");
}

export function getOpencodeSessionId(): string {
	const existing = sessionStore.get();
	if (existing) return existing;
	const created = `ses_${nextUlid(true)}`;
	sessionStore.set(created);
	return created;
}

export function nextOpencodeRequestId(): string {
	return `msg_${nextUlid(false)}`;
}

export function opencodeHeaders(existing?: Record<string, string>): Record<string, string> {
	return {
		...existing,
		"User-Agent": OPENCODE_CLIENT_VERSION,
		"x-opencode-client": "opencode",
		"x-opencode-session": getOpencodeSessionId(),
		"x-opencode-request": nextOpencodeRequestId(),
		"x-opencode-project": "global",
	};
}

export function isOpencodeFreeId(value: string | undefined): boolean {
	return value === OPENCODE_FREE_ID;
}
