import { agentDirState } from "../../../helpers/agent-dir.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
	return { ...actual, getAgentDir: () => agentDirState.dir };
});

import type { AgentConfig } from "../../../../extensions/tools/spawn/types.ts";
import { loadAgentDefinitions } from "../../../../extensions/tools/spawn/config/custom-agents.ts";

let rootDir: string;
let globalDir: string;
let projectDir: string;
let projectAgentsDir: string;

function agentFile(frontmatter: string, body = "Body text."): string {
	return `---\n${frontmatter}\n---\n${body}`;
}

function writeAgent(dir: string, name: string, frontmatter: string, body?: string): string {
	const filePath = join(dir, `${name}.md`);
	writeFileSync(filePath, agentFile(frontmatter, body), "utf8");
	return filePath;
}

function writeProjectAgent(name: string, frontmatter: string, body?: string): string {
	return writeAgent(projectAgentsDir, name, frontmatter, body);
}

function load(): Map<string, AgentConfig> {
	return loadAgentDefinitions(projectDir);
}

beforeAll(() => {
	rootDir = mkdtempSync(join(tmpdir(), "pi-adhd-agents-"));
	agentDirState.dir = join(rootDir, "agent");
	globalDir = join(dirname(agentDirState.dir), "couralabs", "subagents");
	projectDir = join(rootDir, "project");
	projectAgentsDir = join(projectDir, ".pi", "couralabs", "subagents");
	mkdirSync(globalDir, { recursive: true });
	mkdirSync(projectAgentsDir, { recursive: true });
});

afterAll(() => {
	rmSync(rootDir, { recursive: true, force: true });
});

describe("loadAgentDefinitions", () => {
	it("loads project and global agents with project replacing global wholesale", () => {
		writeAgent(globalDir, "shared", "description: from global\nmodel: openai/gpt-4o\ntools: read\n");
		writeAgent(globalDir, "global-only", "description: only global\n");
		const sharedPath = writeProjectAgent("shared", "description: from project\nprompt_mode: replace\n");
		writeProjectAgent("local", "description: local agent\n");

		const agents = load();
		expect([...agents.keys()].sort()).toEqual(["global-only", "local", "shared"]);
		expect(agents.get("shared")?.description).toBe("from project");
		expect(agents.get("shared")?.promptMode).toBe("replace");
		expect(agents.get("shared")?.model).toBeUndefined();
		expect(agents.get("shared")?.toolNames).toBeUndefined();
		expect(agents.get("shared")?.allTools).toBe(false);
		expect(agents.get("shared")?.source).toBe("project");
		expect(agents.get("global-only")?.source).toBe("global");
		expect(sharedPath).toContain("shared.md");
	});

	it("parses frontmatter fields into the agent config", () => {
		writeProjectAgent(
			"full",
			[
				"description: full agent",
				"display_name: Full Agent",
				"tools: read, grep",
				"model: anthropic/claude-sonnet-4",
				"thinking: high",
				"max_turns: 10",
				"prompt_mode: replace",
				"inherit_context: true",
				"tool_guideline: Use full for everything.",
			].join("\n"),
		);

		const full = load().get("full");
		expect(full).toMatchObject({
			name: "full",
			displayName: "Full Agent",
			description: "full agent",
			toolNames: ["read", "grep"],
			allTools: false,
			model: "anthropic/claude-sonnet-4",
			thinking: "high",
			maxTurns: 10,
			promptMode: "replace",
			inheritContext: true,
			toolGuideline: "Use full for everything.",
			enabled: true,
			source: "project",
			systemPrompt: "Body text.",
		});
	});

	it("treats tools all as allTools", () => {
		writeProjectAgent("all-list", "tools:\n  - all\n");
		writeProjectAgent("all-scalar", "tools: all\n");

		const agents = load();
		expect(agents.get("all-list")).toMatchObject({ allTools: true, toolNames: undefined });
		expect(agents.get("all-scalar")).toMatchObject({ allTools: true, toolNames: undefined });
	});

	it("treats tools none as an empty tool list", () => {
		writeProjectAgent("none-list", "tools:\n  - none\n");
		writeProjectAgent("none-scalar", "tools: none\n");

		const agents = load();
		expect(agents.get("none-list")?.toolNames).toEqual([]);
		expect(agents.get("none-scalar")?.toolNames).toEqual([]);
	});

	it("leaves omitted tools unresolved for the built-in default list", () => {
		writeProjectAgent("default-tools", "description: plain\n");

		const agent = load().get("default-tools");
		expect(agent?.toolNames).toBeUndefined();
		expect(agent?.allTools).toBe(false);
	});

	it("rejects all mixed with other tool names, naming the file", () => {
		const path = writeProjectAgent("mixed-all", "tools: all, read\n");

		expect(() => load()).toThrow(`Invalid tools field in ${path}: "all" must be the only value`);
		rmSync(path);
	});

	it("rejects none mixed with other tool names, naming the file", () => {
		const path = writeProjectAgent("mixed-none", "tools: none, read\n");

		expect(() => load()).toThrow(`Invalid tools field in ${path}: "none" must be the only value`);
		rmSync(path);
	});

	it("keeps disabled agents loadable but marked enabled false", () => {
		writeProjectAgent("disabled", "description: hidden\nenabled: false\n");

		expect(load().get("disabled")).toMatchObject({ enabled: false });
	});

	it("prefers display_name over name and falls back to name only", () => {
		writeProjectAgent("named-a", "name: Pretty A\ndisplay_name: Shiny A\n");
		writeProjectAgent("named-b", "name: Pretty B\n");
		writeProjectAgent("named-c", "display_name: Shiny C\n");

		const agents = load();
		expect(agents.get("named-a")?.displayName).toBe("Shiny A");
		expect(agents.get("named-b")?.displayName).toBe("Pretty B");
		expect(agents.get("named-c")?.displayName).toBe("Shiny C");
	});

	it("leaves displayName undefined when neither display_name nor name is set", () => {
		writeProjectAgent("plain-name", "");

		expect(load().get("plain-name")?.displayName).toBeUndefined();
	});

	it("falls back the description to the filename", () => {
		writeProjectAgent("no-description", "");

		expect(load().get("no-description")?.description).toBe("no-description");
	});

	it("ignores invalid thinking levels and keeps valid ones", () => {
		writeProjectAgent("bad-thinking", "thinking: loudly\n");
		writeProjectAgent("good-thinking", "thinking: medium\n");

		const agents = load();
		expect(agents.get("bad-thinking")?.thinking).toBeUndefined();
		expect(agents.get("good-thinking")?.thinking).toBe("medium");
	});
});
