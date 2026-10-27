import { afterEach, describe, expect, it } from "vitest";
import { isChildSession, registerChildSession } from "../../shared/child-sessions.ts";

describe("child sessions", () => {
	afterEach(() => {
		(globalThis as Record<symbol, unknown>)[Symbol.for("@couralabs/pi-adhd/spawn-child-sessions")] = undefined;
	});

	it("reports an unregistered id as not a child session", () => {
		expect(isChildSession("session-a")).toBe(false);
	});

	it("reports a registered id as a child session", () => {
		registerChildSession("session-a");
		expect(isChildSession("session-a")).toBe(true);
	});

	it("reports undefined ids as not a child session", () => {
		registerChildSession("session-a");
		expect(isChildSession(undefined)).toBe(false);
	});

	it("keeps registrations separate per id", () => {
		registerChildSession("session-a");
		registerChildSession("session-b");
		expect(isChildSession("session-a")).toBe(true);
		expect(isChildSession("session-b")).toBe(true);
		expect(isChildSession("session-c")).toBe(false);
	});
});
