import { agentDirState } from "../helpers/agent-dir.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});
import {
	GRILL_SECTION,
	POLICY_SECTION,
	PLAN_SECTION,
	STRAIGHT_SECTION,
	SUBMODE_LABEL,
	SUBMODE_NAME,
	SUBMODE_NOTICE,
	SUBMODE_SECTION,
	SUBMODE_STATE_ENTRY_TYPE,
	SUBMODE_TOOLS,
	SUBMODE_PROMPT_FILE,
	formatToolPolicy,
	getSubmode,
	getSubmodePromptSections,
	isSubmode,
	packagedSubmodePrompt,
	restoreSubmodeFromEntries,
	setSubmode,
	submodeColor,
	submodeDirective,
	subscribeSubmode,
	type ActiveSubmode,
	type Submode,
	type ToolNameMap,
} from "../../shared/submodes.ts";

let tempRoot = "";

const toolNames: ToolNameMap = new Map([
	["read", "view"],
	["grep", "search"],
	["find", "locate"],
	["ls", "list"],
	["ask", "interview"],
	["spawn", "delegate"],
	["submode-exit", "submode-exit"],
	["plan-write", "plan-write"],
	["edit", "mutate"],
]);

function submodeState(data: unknown) {
	return { type: "custom", customType: SUBMODE_STATE_ENTRY_TYPE, data };
}

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
	agentDirState.dir = join(tempRoot, "settings.json");
});

afterAll(() => {
	agentDirState.dir = "";
	rmSync(tempRoot, { recursive: true, force: true });
});

describe("isSubmode", () => {
	it("accepts the four known submodes", () => {
		for (const submode of ["none", "plan", "grill", "straight"]) {
			expect(isSubmode(submode)).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(isSubmode("plan-mode")).toBe(false);
		expect(isSubmode("")).toBe(false);
		expect(isSubmode(42)).toBe(false);
		expect(isSubmode(undefined)).toBe(false);
	});
});

describe("submode maps", () => {
	it("names every submode", () => {
		expect(SUBMODE_NAME.none).toBe("none");
		expect(SUBMODE_NAME.plan).toBe("Plan");
		expect(SUBMODE_NAME.grill).toBe("Grill");
		expect(SUBMODE_NAME.straight).toBe("Straight");
	});

	it("labels active submodes with glyphs and leaves none empty", () => {
		expect(SUBMODE_LABEL.none).toBe("");
		expect(SUBMODE_LABEL.plan).toBe("⚼ Plan");
		expect(SUBMODE_LABEL.grill).toBe("𐂐 Grill");
		expect(SUBMODE_LABEL.straight).toBe("⛬ Straight");
	});

	it("maps submodes to section and prompt file names", () => {
		expect(SUBMODE_SECTION.plan).toBe(PLAN_SECTION);
		expect(SUBMODE_SECTION.grill).toBe(GRILL_SECTION);
		expect(SUBMODE_SECTION.straight).toBe(STRAIGHT_SECTION);
		expect(SUBMODE_PROMPT_FILE.plan).toBe("plan.md");
		expect(SUBMODE_PROMPT_FILE.grill).toBe("grill.md");
		expect(SUBMODE_PROMPT_FILE.straight).toBe("straight.md");
	});
});

describe("SUBMODE_TOOLS", () => {
	it("gives plan the read-only tools plus plan-write", () => {
		expect(SUBMODE_TOOLS.plan).toContain("plan-write");
		expect(SUBMODE_TOOLS.plan).toContain("read");
		expect(SUBMODE_TOOLS.plan).toContain("grep");
		expect(SUBMODE_TOOLS.plan).toContain("submode-exit");
		expect(SUBMODE_TOOLS.plan).not.toContain("edit");
		expect(SUBMODE_TOOLS.plan).not.toContain("write");
		expect(SUBMODE_TOOLS.plan).not.toContain("bash");
	});

	it("keeps grill strictly read-only", () => {
		expect(SUBMODE_TOOLS.grill).toContain("read");
		expect(SUBMODE_TOOLS.grill).toContain("ask");
		expect(SUBMODE_TOOLS.grill).not.toContain("plan-write");
		expect(SUBMODE_TOOLS.grill).not.toContain("edit");
		expect(SUBMODE_TOOLS.grill).not.toContain("write");
		expect(SUBMODE_TOOLS.grill).not.toContain("bash");
	});

	it("gives straight the code tools", () => {
		expect(SUBMODE_TOOLS.straight).toEqual(
			expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls", "ask", "spawn", "submode-exit"]),
		);
		expect(SUBMODE_TOOLS.straight).not.toContain("plan-write");
	});
});

describe("submodeDirective", () => {
	it("announces the active submode with its role and handoff", () => {
		const directive = submodeDirective("plan");
		expect(directive).toContain("ACTIVE SUBMODE: Plan.");
		expect(directive).toContain("You are the architect");
		expect(directive).toContain("Do not edit or write files.");
		expect(directive).toContain("`plan-write`");
		expect(directive).toContain("`submode-exit`");
	});

	it("describes the grill role as interview-only", () => {
		const directive = submodeDirective("grill");
		expect(directive).toContain("ACTIVE SUBMODE: Grill.");
		expect(directive).toContain("You are the designer");
		expect(directive).toContain("Do not implement");
	});
});

describe("formatToolPolicy", () => {
	it("renders the allowed and forbidden lists with backticks", () => {
		const policy = formatToolPolicy("grill", ["read", "ask"], ["edit", "write"]);
		expect(policy).toContain("# Tool policy — Grill submode");
		expect(policy).toContain("This section overrides every tool name mentioned anywhere earlier in this prompt.");
		expect(policy).toContain("You may call only these tools: `read`, `ask`.");
		expect(policy).toContain("These tools do not exist in this submode and a call to one fails: `edit`, `write`.");
		expect(policy).toContain("Do not call them, do not name them");
	});
});

describe("packagedSubmodePrompt", () => {
	for (const submode of ["plan", "grill", "straight"] as ActiveSubmode[]) {
		it(`reads the packaged ${submode} prompt`, () => {
			const first = packagedSubmodePrompt(submode);
			expect(first.length).toBeGreaterThan(0);
			expect(packagedSubmodePrompt(submode)).toBe(first);
		});
	}
});

describe("submode store", () => {
	afterEach(() => {
		setSubmode("none");
	});

	it("defaults to none", () => {
		expect(getSubmode()).toBe("none");
	});

	it("stores and reports the active submode", () => {
		setSubmode("plan");
		expect(getSubmode()).toBe("plan");
	});

	it("notifies subscribers on change until unsubscribed", () => {
		const seen: Submode[] = [];
		const unsubscribe = subscribeSubmode((submode) => seen.push(submode));
		setSubmode("grill");
		expect(seen).toEqual(["grill"]);
		unsubscribe();
		setSubmode("none");
		expect(seen).toEqual(["grill"]);
	});
});

describe("getSubmodePromptSections", () => {
	afterEach(() => {
		setSubmode("none");
	});

	it("returns no sections when the submode is none", () => {
		expect(getSubmodePromptSections(toolNames)).toEqual({});
	});

	it("emits the plan section and policy, with tools renamed in the body", () => {
		setSubmode("plan");
		const sections = getSubmodePromptSections(toolNames);
		expect(Object.keys(sections).sort()).toEqual([PLAN_SECTION, POLICY_SECTION].sort());

		const body = sections[PLAN_SECTION];
		expect(body).toContain("ACTIVE SUBMODE: Plan.");
		expect(body).toContain("`plan-write`");
		expect(body).toContain('"interview"');
		expect(body).not.toContain('"ask"');

		const policy = sections[POLICY_SECTION];
		expect(policy).toContain("# Tool policy — Plan submode");
		expect(policy).toContain(
			"You may call only these tools: `delegate`, `interview`, `list`, `locate`, `plan-write`, `search`, `submode-exit`, `view`.",
		);
		expect(policy).toContain("These tools do not exist in this submode and a call to one fails: `mutate`.");
	});

	it("derives the grill policy from the read-only toolset", () => {
		setSubmode("grill");
		const sections = getSubmodePromptSections(toolNames);
		expect(Object.keys(sections).sort()).toEqual([GRILL_SECTION, POLICY_SECTION].sort());

		expect(sections[GRILL_SECTION]).toContain("ACTIVE SUBMODE: Grill.");
		expect(sections[POLICY_SECTION]).toContain(
			"You may call only these tools: `delegate`, `interview`, `list`, `locate`, `search`, `submode-exit`, `view`.",
		);
		expect(sections[POLICY_SECTION]).toContain("a call to one fails: `mutate`, `plan-write`.");
	});

	it("derives the straight policy from the code toolset", () => {
		setSubmode("straight");
		const sections = getSubmodePromptSections(toolNames);
		expect(Object.keys(sections).sort()).toEqual([STRAIGHT_SECTION, POLICY_SECTION].sort());

		expect(sections[STRAIGHT_SECTION]).toContain("ACTIVE SUBMODE: Straight.");
		expect(sections[STRAIGHT_SECTION]).toContain("`delegate`");
		expect(sections[STRAIGHT_SECTION]).not.toContain("`spawn`");
		expect(sections[STRAIGHT_SECTION]).toContain("`interview`");
		expect(sections[POLICY_SECTION]).toContain("`mutate`");
		expect(sections[POLICY_SECTION]).toContain("These tools do not exist in this submode and a call to one fails: `plan-write`.");
	});
});

describe("restoreSubmodeFromEntries", () => {
	it("returns undefined without submode-state entries", () => {
		expect(restoreSubmodeFromEntries([])).toBeUndefined();
		expect(restoreSubmodeFromEntries([{ type: "message" }, { type: "custom" }])).toBeUndefined();
	});

	it("scans backwards so the latest snapshot wins", () => {
		const entries = [submodeState({ submode: "plan" }), { type: "message" }, submodeState({ submode: "straight" })];
		expect(restoreSubmodeFromEntries(entries)).toBe("straight");
	});

	it("skips invalid snapshots instead of failing", () => {
		const entries = [submodeState({}), submodeState({ submode: "bogus" }), submodeState({ submode: "grill" })];
		expect(restoreSubmodeFromEntries(entries)).toBe("grill");
	});

	it("accepts the none submode as a valid snapshot", () => {
		expect(restoreSubmodeFromEntries([submodeState({ submode: "none" })])).toBe("none");
	});
});

describe("submodeColor", () => {
	it("colors each submode", () => {
		expect(submodeColor("none")).toBe("success");
		expect(submodeColor("plan")).toBe("success");
		expect(submodeColor("grill")).toBe("warning");
		expect(submodeColor("straight")).toBe("accent");
	});
});

describe("SUBMODE_NOTICE", () => {
	it("is non-empty for every submode and labels the active ones", () => {
		for (const submode of ["none", "plan", "grill", "straight"] as Submode[]) {
			expect(SUBMODE_NOTICE[submode].length).toBeGreaterThan(0);
		}
		expect(SUBMODE_NOTICE.none).toContain("Submode off");
		expect(SUBMODE_NOTICE.plan).toContain(SUBMODE_LABEL.plan);
		expect(SUBMODE_NOTICE.grill).toContain(SUBMODE_LABEL.grill);
		expect(SUBMODE_NOTICE.straight).toContain(SUBMODE_LABEL.straight);
	});
});
