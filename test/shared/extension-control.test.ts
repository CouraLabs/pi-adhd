import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXTENSION_CATALOG } from "../../shared/extension-catalog.ts";
import { isExtensionEnabled, loadEnabledExtensions, setExtensionEnabled } from "../../shared/extension-control.ts";
import { loadSettings } from "../../shared/settings.ts";
import type { ExtensionName } from "../../shared/extension-registry.ts";
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

describe("loadEnabledExtensions", () => {
	it("returns all defaults when the extensions key is missing", () => {
		expect(loadEnabledExtensions()).toEqual(new Set(EXTENSION_CATALOG.map((entry) => entry.name)));
	});

	it("filters unknown and invalid entries from the stored array", () => {
		loadSettings();
		const stored = ["thinking", "bogus", "SESSION-TITLE", 42, null, "ask"];
		writeFileSync(join(dirname(agentDirState.dir), "couralabs", "settings.json"), JSON.stringify({ extensions: stored }), "utf8");
		const enabled = loadEnabledExtensions();
		expect(enabled.has("thinking")).toBe(true);
		expect(enabled.has("session-title")).toBe(true);
		expect(enabled.has("ask-user")).toBe(true);
		expect(enabled.size).toBe(3);
	});
});

describe("isExtensionEnabled", () => {
	it("reports enablement from the stored list", () => {
		expect(isExtensionEnabled("web" as ExtensionName)).toBe(true);
		setExtensionEnabled("web" as ExtensionName, false);
		expect(isExtensionEnabled("web" as ExtensionName)).toBe(false);
	});
});

describe("setExtensionEnabled", () => {
	it("persists a catalog-ordered list without the disabled name", () => {
		setExtensionEnabled("timer" as ExtensionName, false);
		const stored = loadSettings().extensions;
		expect(stored).not.toContain("timer");
		expect(stored).toEqual(EXTENSION_CATALOG.map((entry) => entry.name).filter((name) => name !== "timer"));
	});

	it("re-adds a previously disabled name in catalog order", () => {
		setExtensionEnabled("timer" as ExtensionName, false);
		setExtensionEnabled("timer" as ExtensionName, true);
		const stored = loadSettings().extensions;
		expect(stored).toEqual(EXTENSION_CATALOG.map((entry) => entry.name));
	});
});
