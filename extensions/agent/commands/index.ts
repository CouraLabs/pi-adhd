import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";

const COMMAND_PREFIX = "cmd:";

const COMMAND_DIRS: readonly string[] = [".agents/commands", ".claude/commands"];

const MAX_DEPTH = 4;

interface CommandFile {

	name: string;

	description: string;

	body: string;
}

function parseCommandFile(path: string, name: string): CommandFile | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	const { frontmatter, body } = splitFrontmatter(raw);
	const described = describe(frontmatter, body);
	return described ? { name, description: described, body } : undefined;
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
	const withoutBom = raw.replace(/^\uFEFF/, "");
	const lines = withoutBom.split("\n");
	if ((lines[0] ?? "").trim() !== "---") return { frontmatter: "", body: withoutBom };
	const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (close < 0) return { frontmatter: "", body: withoutBom };
	return {
		frontmatter: lines.slice(1, close).join("\n"),
		body: lines.slice(close + 1).join("\n").replace(/^\s*\n+/, ""),
	};
}

function describe(frontmatter: string, body: string): string {
	const declared = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
	if (declared) return declared;
	return body.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function sanitizeSegment(segment: string): string {
	return segment.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
}

function collectCommands(dir: string, prefix: string, depth: number): Array<{ name: string; path: string }> {
	const out: Array<{ name: string; path: string }> = [];
	if (depth > MAX_DEPTH) return out;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
			const segment = sanitizeSegment(entry.name.replace(/\.md$/i, ""));
			if (segment) out.push({ name: prefix ? `${prefix}:${segment}` : segment, path: join(dir, entry.name) });
		} else if (entry.isDirectory()) {
			const segment = sanitizeSegment(entry.name);
			if (segment) out.push(...collectCommands(join(dir, entry.name), prefix ? `${prefix}:${segment}` : segment, depth + 1));
		}
	}
	return out;
}

export function composePrompt(body: string, args: string): string {
	const typed = args.trim();
	if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", typed);
	return typed ? `${body}\n\n${typed}` : body;
}

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("commands");

	const cwd = process.cwd();
	const seen = new Set<string>();
	for (const dir of COMMAND_DIRS) {
		const root = isAbsolute(dir) ? dir : join(cwd, dir);
		for (const { name, path } of collectCommands(root, "", 0)) {
			if (seen.has(name)) continue;
			const command = parseCommandFile(path, name);
			if (!command) continue;
			seen.add(name);
			registerPromptCommand(pi, command, path);
		}
	}
}

function registerPromptCommand(pi: ExtensionAPI, command: CommandFile, path: string): void {
	pi.registerCommand(`${COMMAND_PREFIX}${command.name}`, {
		description: command.description || `prompt command from ${path}`,
		handler: async (args) => {
			await pi.sendUserMessage(composePrompt(command.body, args));
		},
	});
}
