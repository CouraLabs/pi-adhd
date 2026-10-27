import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});
import {
	agentModeBorderColor,
	agentModeColor,
	agentModeLabel,
	getAgentMode,
	isAgentMode,
	isClaudeProvider,
	isSelectableAgentMode,
	listAgentModes,
	modeNotice,
	nextAgentMode,
	readModePrompt,
	restoreModeSnapshotFromEntries,
	setAgentMode,
	subscribeAgentMode,
	userModesDir,
} from "../../shared/modes.ts";

let tempRoot = "";

function writeModeFile(name: string, content = `prompt for ${name}\n`): void {
	mkdirSync(userModesDir(), { recursive: true });
	writeFileSync(join(userModesDir(), `${name}.md`), content, "utf8");
}

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(tempRoot, "settings.json");
});

afterAll(() => {
	agentDirState.dir = "";
	rmSync(tempRoot, { recursive: true, force: true });
});

describe("isClaudeProvider", () => {
	it("matches only the claude provider id", () => {
		expect(isClaudeProvider("claude")).toBe(true);
		expect(isClaudeProvider("openai")).toBe(false);
		expect(isClaudeProvider(undefined)).toBe(false);
	});
});

describe("nextAgentMode", () => {
	it("advances to the next mode in the list", () => {
		expect(nextAgentMode("pi", ["pi", "work", "deep"])).toBe("work");
	});

	it("wraps around after the last mode", () => {
		expect(nextAgentMode("deep", ["pi", "work", "deep"])).toBe("pi");
	});

	it("falls back to the first mode for an unknown current mode", () => {
		expect(nextAgentMode("unknown", ["pi", "work"])).toBe("pi");
	});
});

describe("agentModeLabel", () => {
	it("labels the built-in pi mode", () => {
		expect(agentModeLabel("pi")).toBe("π Pi");
	});

	it("labels the built-in work mode", () => {
		expect(agentModeLabel("work")).toBe("⦵ Work");
	});

	it("labels the claude mode", () => {
		expect(agentModeLabel("claude")).toBe("🞻 Claude");
	});

	it("capitalizes custom modes", () => {
		expect(agentModeLabel("deep")).toBe("◈ Deep");
	});
});

describe("modeNotice", () => {
	it("describes the pi mode as passthrough", () => {
		const notice = modeNotice("pi");
		expect(notice).toContain("π Pi");
		expect(notice).toContain("pi's default system prompt is in effect");
	});

	it("describes the claude mode as SDK-driven", () => {
		const notice = modeNotice("claude");
		expect(notice).toContain("🞻 Claude");
		expect(notice).toContain("Claude Agent SDK drives the run");
	});

	it("describes other modes as prompt-replacing", () => {
		const notice = modeNotice("deep");
		expect(notice).toContain("◈ Deep");
		expect(notice).toContain("'deep'");
		expect(notice).toContain("default system prompt");
	});
});

describe("isAgentMode and isSelectableAgentMode", () => {
	it("accepts non-empty strings as agent modes", () => {
		expect(isAgentMode("work")).toBe(true);
		expect(isAgentMode("pi")).toBe(true);
	});

	it("rejects empty strings, blanks, and non-strings", () => {
		expect(isAgentMode("")).toBe(false);
		expect(isAgentMode("   ")).toBe(false);
		expect(isAgentMode(42)).toBe(false);
		expect(isAgentMode(undefined)).toBe(false);
	});

	it("excludes the claude mode from selectable modes", () => {
		expect(isSelectableAgentMode("work")).toBe(true);
		expect(isSelectableAgentMode("claude")).toBe(false);
		expect(isSelectableAgentMode("")).toBe(false);
	});
});

describe("restoreModeSnapshotFromEntries", () => {
	function modeState(data: unknown) {
		return { type: "custom", customType: "mode-state", data };
	}

	it("returns undefined without mode-state entries", () => {
		expect(restoreModeSnapshotFromEntries([{ type: "message" }, { type: "custom" }])).toBeUndefined();
		expect(restoreModeSnapshotFromEntries([])).toBeUndefined();
	});

	it("scans backwards so the latest snapshot wins", () => {
		const entries = [modeState({ mode: "pi" }), { type: "message" }, modeState({ mode: "work" })];
		expect(restoreModeSnapshotFromEntries(entries)).toEqual({ mode: "work" });
	});

	it("skips snapshots with an invalid mode", () => {
		const entries = [modeState({ mode: "" }), modeState({})];
		expect(restoreModeSnapshotFromEntries(entries)).toBeUndefined();
	});

	it("keeps a selectable previous mode", () => {
		const entries = [modeState({ mode: "claude", previousMode: "work" })];
		expect(restoreModeSnapshotFromEntries(entries)).toEqual({ mode: "claude", previousMode: "work" });
	});

	it("drops a previous mode that is claude", () => {
		const entries = [modeState({ mode: "work", previousMode: "claude" })];
		expect(restoreModeSnapshotFromEntries(entries)).toEqual({ mode: "work" });
	});

	it("drops a non-string previous mode", () => {
		const entries = [modeState({ mode: "work", previousMode: 42 })];
		expect(restoreModeSnapshotFromEntries(entries)).toEqual({ mode: "work" });
	});
});

describe("agent mode colors", () => {
	it("colors the work mode as text and others as accent", () => {
		expect(agentModeColor("work")).toBe("text");
		expect(agentModeColor("pi")).toBe("accent");
		expect(agentModeColor("deep")).toBe("accent");
	});

	it("borders the pi mode with accent", () => {
		expect(agentModeBorderColor("pi")).toBe("accent");
	});

	it("borders the work mode with border", () => {
		expect(agentModeBorderColor("work")).toBe("border");
	});

	it("borders custom modes with borderAccent", () => {
		expect(agentModeBorderColor("deep")).toBe("borderAccent");
		expect(agentModeBorderColor("claude")).toBe("borderAccent");
	});
});

describe("agent mode store", () => {
	afterEach(() => {
		setAgentMode("work");
	});

	it("defaults to the work mode", () => {
		expect(getAgentMode()).toBe("work");
	});

	it("stores and reports the current mode", () => {
		setAgentMode("pi");
		expect(getAgentMode()).toBe("pi");
	});

	it("notifies subscribers on change until unsubscribed", () => {
		const seen: string[] = [];
		const unsubscribe = subscribeAgentMode((mode) => seen.push(mode));
		setAgentMode("pi");
		expect(seen).toEqual(["pi"]);
		unsubscribe();
		setAgentMode("work");
		expect(seen).toEqual(["pi"]);
	});
});

describe("user mode files", () => {
	afterEach(() => {
		setAgentMode("work");
		rmSync(userModesDir(), { recursive: true, force: true });
	});

	it("resolves the modes dir under the agent dir's prompts folder", () => {
		expect(userModesDir()).toBe(join(tempRoot, "couralabs", "prompts", "modes"));
	});

	it("always includes the built-in pi mode", () => {
		expect(listAgentModes()).toEqual(["pi"]);
	});

	it("lists .md files alongside pi, filtering claude, sorted case-insensitively", () => {
		writeModeFile("Zeta");
		writeModeFile("alpha");
		writeModeFile("Beta");
		writeModeFile("claude");
		writeModeFile("pi");
		writeFileSync(join(userModesDir(), "notes.txt"), "not a mode", "utf8");
		expect(listAgentModes()).toEqual(["alpha", "Beta", "pi", "Zeta"]);
	});

	it("reads a mode prompt from the modes dir", () => {
		writeModeFile("deep", "DEEP PROMPT BODY\n");
		expect(readModePrompt("deep")).toBe("DEEP PROMPT BODY\n");
	});

	it("returns undefined for missing or empty prompts", () => {
		writeModeFile("empty", "   \n");
		expect(readModePrompt("empty")).toBeUndefined();
		expect(readModePrompt("missing")).toBeUndefined();
	});
});
