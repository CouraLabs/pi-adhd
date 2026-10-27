import { agentDirState } from "../helpers/agent-dir.ts";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FEATURE_TOGGLES, featureToggleIdList, resolveFeatureToggle } from "../../shared/feature-toggles.ts";
import { loadSettings } from "../../shared/settings.ts";
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

let root = "";

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(root, "agent");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
	rmSync(join(dirname(agentDirState.dir), "couralabs"), { recursive: true, force: true });
});

describe("resolveFeatureToggle", () => {
	it("matches case-insensitively and trims input", () => {
		expect(resolveFeatureToggle("  SESSION-TITLE ")).toBe(FEATURE_TOGGLES[0]);
		expect(resolveFeatureToggle("Session-Title")).toBe(FEATURE_TOGGLES[0]);
	});

	it("returns undefined for unknown toggles", () => {
		expect(resolveFeatureToggle("bogus")).toBeUndefined();
		expect(resolveFeatureToggle("")).toBeUndefined();
	});
});

describe("featureToggleIdList", () => {
	it("joins toggle ids", () => {
		expect(featureToggleIdList()).toBe("session-title");
	});
});

describe("FEATURE_TOGGLES", () => {
	it("entries carry a label and description", () => {
		for (const entry of FEATURE_TOGGLES) {
			expect(entry.label.length).toBeGreaterThan(0);
			expect(entry.description.length).toBeGreaterThan(0);
		}
	});
});

describe("session-title toggle", () => {
	it("round-trips enabled state through the settings file", () => {
		const toggle = resolveFeatureToggle("session-title");
		expect(toggle).toBeDefined();
		expect(loadSettings().sessionTitle.enabled).toBe(true);

		toggle!.setEnabled(false);
		expect(loadSettings().sessionTitle.enabled).toBe(false);

		toggle!.setEnabled(true);
		expect(loadSettings().sessionTitle.enabled).toBe(true);
	});

	it("persists only the sessionTitle key", () => {
		resolveFeatureToggle("session-title")!.setEnabled(false);
		const stored = JSON.parse(readFileSync(join(dirname(agentDirState.dir), "couralabs", "settings.json"), "utf8"));
		expect(existsSync(join(dirname(agentDirState.dir), "couralabs", "settings.json"))).toBe(true);
		expect(stored.sessionTitle).toEqual({ enabled: false });
	});
});
