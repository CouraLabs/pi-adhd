import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../../../extensions/tools/web/util.ts";

describe("getErrorMessage", () => {
	it("returns the message for Error instances", () => {
		expect(getErrorMessage(new Error("boom"))).toBe("boom");
	});

	it("stringifies non-Error values", () => {
		expect(getErrorMessage("plain")).toBe("plain");
		expect(getErrorMessage(42)).toBe("42");
		expect(getErrorMessage({ code: 7 })).toBe("[object Object]");
		expect(getErrorMessage(undefined)).toBe("undefined");
	});
});
