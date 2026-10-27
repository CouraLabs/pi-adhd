import { describe, expect, it } from "vitest";
import { deriveSpawnSessionDir } from "../../../../extensions/tools/spawn/session/session-dir.ts";

describe("deriveSpawnSessionDir", () => {
	it("derives a sibling tasks dir from the parent session file", () => {
		expect(deriveSpawnSessionDir("/a/b/session.jsonl", "/elsewhere")).toBe("/a/b/session/tasks");
	});

	it("builds a tmpdir-based path when there is no parent session file", () => {
		const result = deriveSpawnSessionDir(undefined, "/Users/rodcoura/Projects");
		expect(result).toContain("tasks");
		expect(result).not.toContain("/Users/rodcoura/Projects");
	});

	it("encodes the cwd with slashes and leading separators stripped", () => {
		const result = deriveSpawnSessionDir(undefined, "/Users/rodcoura/Projects");
		expect(result).toContain("Users-rodcoura-Projects");
		expect(result).not.toMatch(/^-/);
	});

	it("is deterministic for the same cwd", () => {
		expect(deriveSpawnSessionDir(undefined, "/x/y")).toBe(deriveSpawnSessionDir(undefined, "/x/y"));
	});
});
