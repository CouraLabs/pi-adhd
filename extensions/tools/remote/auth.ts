import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "pi_remote";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 10;

function digest(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

export function parseCookies(header: string | undefined): Map<string, string> {
	const cookies = new Map<string, string>();
	for (const part of (header ?? "").split(";")) {
		const index = part.indexOf("=");
		if (index <= 0) continue;
		cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
	}
	return cookies;
}

export class RemoteAuth {

	readonly #expected: Buffer;

	readonly #sessions = new Map<string, number>();

	#failures: number[] = [];

	constructor(password: string) {
		this.#expected = digest(password);
	}

	get isLockedOut(): boolean {
		this.#pruneFailures(Date.now());
		return this.#failures.length >= MAX_FAILURES_PER_WINDOW;
	}

	login(password: string): string | undefined {
		const now = Date.now();
		if (this.isLockedOut) return undefined;
		if (!timingSafeEqual(digest(password), this.#expected)) {
			this.#failures.push(now);
			return undefined;
		}
		const token = randomBytes(32).toString("base64url");
		this.#sessions.set(token, now + SESSION_TTL_MS);
		return token;
	}

	logout(request: IncomingMessage): void {
		const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
		if (token) this.#sessions.delete(token);
	}

	isAuthorized(request: IncomingMessage): boolean {
		const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
		if (!token) return false;
		const expiresAt = this.#sessions.get(token);
		if (expiresAt === undefined) return false;
		if (expiresAt < Date.now()) {
			this.#sessions.delete(token);
			return false;
		}
		return true;
	}

	#pruneFailures(now: number): void {
		this.#failures = this.#failures.filter((at) => now - at < FAILURE_WINDOW_MS);
	}
}
