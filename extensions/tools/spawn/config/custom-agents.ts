import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { globalAgentsDir, projectAgentsDir } from "./agent-dirs.ts";
import { parseThinkingLevel, thinkingLevelError } from "./thinking-level.ts";
import { debugLog } from "../debug.ts";
import type { AgentConfig } from "../types.ts";

export function loadAgentDefinitions(cwd: string): Map<string, AgentConfig> {
	const agents = new Map<string, AgentConfig>();
	loadFromDir(globalAgentsDir(), agents, "global");
	loadFromDir(projectAgentsDir(cwd), agents, "project");
	return agents;
}

function loadFromDir(dir: string, agents: Map<string, AgentConfig>, source: "project" | "global"): void {
	if (!existsSync(dir)) return;

	let files: string[];
	try {
		files = readdirSync(dir).filter(f => f.endsWith(".md"));
	} catch (err) {
		debugLog("readdirSync agents dir", err);
		return;
	}

	for (const file of files) {
		const name = basename(file, ".md");
		const filePath = join(dir, file);

		let content: string;
		try {
			content = readFileSync(filePath, "utf-8");
		} catch (err) {
			debugLog("readFileSync agent file", err);
			continue;
		}

		let fm: Record<string, unknown>;
		let body: string;
		try {
			const parsed = parseFrontmatter(content);
			fm = parsed.frontmatter;
			body = parsed.body;
		} catch (err) {
			throw new Error(`Invalid frontmatter in ${filePath}: ${(err as Error).message}`);
		}

		agents.set(name, {
			name,
			displayName: str(fm.display_name),
			description: str(fm.description) ?? name,
			...toolSelection(fm.tools, filePath),
			model: str(fm.model),
			thinking: thinkingLevel(fm.thinking, name),
			maxTurns: nonNegativeInt(fm.max_turns),
			systemPrompt: body.trim(),
			promptMode: fm.prompt_mode === "replace" ? "replace" : "append",
			inheritContext: fm.inherit_context != null ? fm.inherit_context === true : undefined,
			toolGuideline: str(fm.tool_guideline),
			enabled: fm.enabled !== false,
			source,
		});
	}
}

function toolSelection(value: unknown, filePath: string): Pick<AgentConfig, "toolNames" | "allTools"> {
	if (value === undefined || value === null) return { allTools: false };

	const items = parseListField(value);
	if (items === undefined) return { allTools: false };

	if (items.length === 1 && items[0] === "all") return { allTools: true, toolNames: undefined };
	if (items.length === 1 && items[0] === "none") return { allTools: false, toolNames: [] };
	if (items.includes("all")) {
		throw new Error(`Invalid tools field in ${filePath}: "all" must be the only value`);
	}
	if (items.includes("none")) {
		throw new Error(`Invalid tools field in ${filePath}: "none" must be the only value`);
	}
	return { allTools: false, toolNames: items };
}

function str(val: unknown): string | undefined {
	return typeof val === "string" ? val : undefined;
}

function thinkingLevel(val: unknown, agentName: string): AgentConfig["thinking"] {
	const level = parseThinkingLevel(val);
	if (val != null && level === undefined) {
		debugLog(`agent ${agentName} frontmatter thinking`, thinkingLevelError(val));
	}
	return level;
}

function nonNegativeInt(val: unknown): number | undefined {
	return typeof val === "number" && val >= 0 ? val : undefined;
}

function parseListField(val: unknown): string[] | undefined {
	if (val === undefined || val === null) return undefined;
	const items = (Array.isArray(val) ? val : String(val).trim().split(","))
		.map(entry => String(entry).trim().replace(/^["'](.*)["']$/, "$1").trim())
		.filter(Boolean);
	return items.length === 0 ? undefined : items;
}
