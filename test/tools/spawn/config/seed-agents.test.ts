import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPackagedSeedAgents } from "../../../../extensions/tools/spawn/config/seed-source.ts";
import { provisionDefaultAgents } from "../../../../extensions/tools/spawn/config/seed-agents.ts";
import { AGENTS_INITIALIZED_MARKER } from "../../../../extensions/tools/spawn/config/agent-dirs.ts";

const EXPECTED_SEED_NAMES = ["Arquitect", "Code-Review", "Explore", "general-purpose", "plan-reviewer", "qa"];

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `pi-adhd-${prefix}-`));
}

function seededContent(name: string): string {
	return readFileSync(join(process.cwd(), "extensions/tools/spawn/config/default-agents", `${name}.md`), "utf8");
}

describe("provisionDefaultAgents", () => {
	const dirs: string[] = [];

	function freshDir(): string {
		const dir = makeTempDir("agents");
		dirs.push(dir);
		return dir;
	}

	afterAll(() => {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	});

	it("provisions all seed files and the marker in a fresh directory", () => {
		const targetDir = freshDir();
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents());
		for (const name of EXPECTED_SEED_NAMES) {
			expect(readFileSync(join(targetDir, `${name}.md`), "utf8")).toBe(seededContent(name));
		}
		expect(existsSync(join(targetDir, AGENTS_INITIALIZED_MARKER))).toBe(true);
	});

	it("writes nothing when the marker already exists", () => {
		const targetDir = freshDir();
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents());
		const generalPurposePath = join(targetDir, "general-purpose.md");
		writeFileSync(generalPurposePath, "user edit", "utf8");
		rmSync(join(targetDir, "Explore.md"));
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents());
		expect(readFileSync(generalPurposePath, "utf8")).toBe("user edit");
		expect(existsSync(join(targetDir, "Explore.md"))).toBe(false);
	});

	it("never overwrites an existing destination file", () => {
		const targetDir = freshDir();
		const qaPath = join(targetDir, "qa.md");
		writeFileSync(qaPath, "custom qa definition", "utf8");
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents());
		expect(readFileSync(qaPath, "utf8")).toBe("custom qa definition");
		expect(readFileSync(join(targetDir, "Explore.md"), "utf8")).toBe(seededContent("Explore"));
	});

	it("merges seed frontmatter with a non-empty legacy body", () => {
		const targetDir = freshDir();
		const legacyDir = makeTempDir("legacy");
		dirs.push(legacyDir);
		writeFileSync(join(legacyDir, "general-purpose.md"), "My customized general prompt.", "utf8");
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents(), legacyDir);
		const merged = readFileSync(join(targetDir, "general-purpose.md"), "utf8");
		expect(merged).toBe(
			[
				"---",
				'description: "General-purpose agent for complex, multi-step tasks"',
				'display_name: "Agent"',
				"prompt_mode: append",
				'tool_guideline: "- Use general-purpose for complex tasks that need file editing."',
				"---",
				"",
				"My customized general prompt.",
				"",
			].join("\n"),
		);
		expect(readFileSync(join(targetDir, "Explore.md"), "utf8")).toBe(seededContent("Explore"));
	});

	it("copies the packaged seed when the legacy body is empty", () => {
		const targetDir = freshDir();
		const legacyDir = makeTempDir("legacy");
		dirs.push(legacyDir);
		writeFileSync(join(legacyDir, "qa.md"), "   \n\t\n", "utf8");
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents(), legacyDir);
		expect(readFileSync(join(targetDir, "qa.md"), "utf8")).toBe(seededContent("qa"));
	});

	it("deletes the legacy dir after provisioning with a legacyDir", () => {
		const targetDir = freshDir();
		const legacyDir = makeTempDir("legacy");
		dirs.push(legacyDir);
		writeFileSync(join(legacyDir, "general-purpose.md"), "My customized general prompt.", "utf8");
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents(), legacyDir);
		expect(existsSync(legacyDir)).toBe(false);
	});

	it("leaves the legacy dir untouched when the marker already exists", () => {
		const targetDir = freshDir();
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents());
		const legacyDir = makeTempDir("legacy");
		dirs.push(legacyDir);
		writeFileSync(join(legacyDir, "qa.md"), "keep me", "utf8");
		provisionDefaultAgents(targetDir, loadPackagedSeedAgents(), legacyDir);
		expect(existsSync(legacyDir)).toBe(true);
		expect(readFileSync(join(legacyDir, "qa.md"), "utf8")).toBe("keep me");
	});

	it("does nothing extra without a legacyDir", () => {
		const targetDir = freshDir();
		expect(() => provisionDefaultAgents(targetDir, loadPackagedSeedAgents(), undefined)).not.toThrow();
		expect(existsSync(join(targetDir, AGENTS_INITIALIZED_MARKER))).toBe(true);
	});
});

describe("loadPackagedSeedAgents", () => {
	it("returns the six packaged seed agents sorted by filename", () => {
		const seeds = loadPackagedSeedAgents();
		expect(seeds.map((seed) => seed.name)).toEqual(EXPECTED_SEED_NAMES);
		for (const seed of seeds) {
			expect(seed.content).toContain("---");
			expect(seed.content.length).toBeGreaterThan(0);
		}
	});
});
