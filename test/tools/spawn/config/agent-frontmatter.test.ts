import { agentDirState } from "../../../helpers/agent-dir.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

const fsState = vi.hoisted(() => ({
	exists: new Set<string>(),
	dirs: new Map<string, string[]>(),
	files: new Map<string, string>(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: vi.fn((path: string) => fsState.exists.has(path) || fsState.dirs.has(path)),
		readdirSync: vi.fn((path: string) => fsState.dirs.get(path) ?? []),
		readFileSync: vi.fn((path: string) => {
			const content = fsState.files.get(path);
			if (content === undefined) throw new Error(`ENOENT: ${path}`);
			return content;
		}),
	};
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => "/fake-home" };
});

import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import {
	removeFrontmatterValue,
	writeFrontmatterValue,
} from "../../../../extensions/tools/spawn/config/agent-frontmatter.ts";
import { loadCustomAgents } from "../../../../extensions/tools/spawn/config/custom-agents.ts";

const GLOBAL_DIR = "/fake-home/.agents/agents";
const PROJECT_DIR = "/fake-project/.agents/agents";

function agentFile(frontmatter: string, body = "Body text."): string {
	return `---\n${frontmatter}\n---\n${body}`;
}

describe("writeFrontmatterValue", () => {
	it("creates a frontmatter block on plain content", () => {
		expect(writeFrontmatterValue("Hello", "description", "Does things")).toBe(
			'---\ndescription: "Does things"\n---\n\nHello',
		);
	});

	it("quotes values with special characters", () => {
		expect(writeFrontmatterValue("Hello", "description", 'Say: "hi"')).toBe(
			'---\ndescription: "Say: \\"hi\\""\n---\n\nHello',
		);
	});

	it("replaces an existing key inside the frontmatter block", () => {
		const content = "---\ndescription: old\ntitle: t\n---\nBody";
		expect(writeFrontmatterValue(content, "description", "new")).toBe(
			"---\ndescription: new\ntitle: t\n---\nBody",
		);
	});

	it("appends a missing key to an existing frontmatter block", () => {
		const content = "---\ntitle: t\n---\nBody";
		expect(writeFrontmatterValue(content, "description", "d")).toBe(
			"---\ntitle: t\ndescription: d\n---\nBody",
		);
	});
});

describe("removeFrontmatterValue", () => {
	it("removes the key line from an existing frontmatter block", () => {
		const content = "---\ndescription: d\ntitle: t\n---\nBody";
		expect(removeFrontmatterValue(content, "description")).toBe("---\ntitle: t\n---\nBody");
	});

	it("returns content unchanged when there is no frontmatter block", () => {
		expect(removeFrontmatterValue("Plain", "description")).toBe("Plain");
	});

	it("returns the block unchanged when the key is absent", () => {
		const content = "---\ntitle: t\n---\nBody";
		expect(removeFrontmatterValue(content, "description")).toBe(content);
	});
});

describe("loadCustomAgents", () => {
	beforeAll(() => {
		agentDirState.dir = mkdtempSync(join(tmpdir(), "pi-adhd-test-"));
		fsState.dirs.set(GLOBAL_DIR, ["shared.md"]);
		fsState.dirs.set(PROJECT_DIR, ["shared.md", "local.md"]);
		fsState.files.set(
			join(GLOBAL_DIR, "shared.md"),
			agentFile("description: from global\nmodel: openai/gpt-4o\n"),
		);
		fsState.files.set(
			join(PROJECT_DIR, "shared.md"),
			agentFile("description: from project\nprompt_mode: replace\n"),
		);
		fsState.files.set(
			join(PROJECT_DIR, "local.md"),
			agentFile(
				"description: local agent\ntools: read, grep\nthinking: high\nmax_turns: 10\ninherit_context: true\nlocked: model, thinking\n",
			),
		);
	});

	afterAll(() => {
		rmSync(agentDirState.dir, { recursive: true, force: true });
	});

	it("loads project and global agents with project overriding global", () => {
		const agents = loadCustomAgents("/fake-project");
		expect([...agents.keys()].sort()).toEqual(["local", "shared"]);
		expect(agents.get("shared")?.description).toBe("from project");
		expect(agents.get("shared")?.promptMode).toBe("replace");
	});

	it("parses frontmatter fields into the agent config", () => {
		const agents = loadCustomAgents("/fake-project");
		const local = agents.get("local") as AgentConfig;
		expect(local).toMatchObject({
			name: "local",
			description: "local agent",
			toolNames: ["read", "grep"],
			thinking: "high",
			maxTurns: 10,
			promptMode: "append",
			inheritContext: true,
			locked: ["model", "thinking"],
			enabled: true,
			source: "project",
			systemPrompt: "Body text.",
		});
	});

	it("replaces the whole agent config when a project file shares a global name", () => {
		const agents = loadCustomAgents("/fake-project");
		expect(agents.get("shared")?.description).toBe("from project");
		expect(agents.get("shared")?.model).toBeUndefined();
		expect(agents.get("shared")?.source).toBe("project");
	});
});
