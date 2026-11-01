import { describe, expect, it } from "vitest";
import { getOpencodeSessionId, nextOpencodeRequestId, opencodeHeaders } from "../../../extensions/providers/opencode/identity.ts";

describe("opencode identity", () => {
	it("keeps one session id per process", () => {
		expect(getOpencodeSessionId()).toBe(getOpencodeSessionId());
		expect(getOpencodeSessionId().startsWith("ses_")).toBe(true);
	});

	it("mints fresh msg_ request ids", () => {
		const first = nextOpencodeRequestId();
		const second = nextOpencodeRequestId();
		expect(first.startsWith("msg_")).toBe(true);
		expect(first).not.toBe(second);
	});

	it("stamps cli headers with fresh request ids", () => {
		const first = opencodeHeaders();
		const second = opencodeHeaders();
		expect(first["x-opencode-client"]).toBe("opencode");
		expect(first["x-opencode-project"]).toBe("global");
		expect(first["User-Agent"]).toBe("opencode/latest/2.2.5/opencode");
		expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
		expect(first["x-opencode-request"]).not.toBe(second["x-opencode-request"]);
	});
});
