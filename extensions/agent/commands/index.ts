/**
 * commands — project prompt commands from `.agents/commands` and
 * `.claude/commands`.
 *
 * Scans those two project folders for markdown files and registers each as a
 * pi command named `cmd:<file-name>` (nested folders namespace with colons:
 * `.agents/commands/review/plan.md` → `/cmd:review:plan`). Running the command
 * sends the file's content to the conversation as the user prompt — saved
 * multi-step instructions, one invocation each.
 *
 * File format follows the `.claude` and `.agents` conventions (see the
 * packaged `promote.md` for a worked example): an optional frontmatter block
 * carries `description`, used verbatim as the command's description in the
 * command list, and the body after the frontmatter is the prompt. `$ARGUMENTS`
 * is replaced with whatever the operator typed after the command name; with an
 * empty placeholder-free body the typed text is appended. Other frontmatter
 * keys are ignored, and the files are read at load time — edits and added
 * commands appear on the next `/reload`.
 *
 * `.agents/commands` is scanned first, so a name present in both folders
 * resolves to the `.agents` copy.
 */

import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";

/** Command-name prefix; `/cmd:<name>` with the prefix making the origin obvious. */
const COMMAND_PREFIX = "cmd:";

/** Project command folders, in precedence order (first hit wins). */
const COMMAND_DIRS: readonly string[] = [".agents/commands", ".claude/commands"];

/** Cap the walk so a runaway tree cannot stall the load. */
const MAX_DEPTH = 4;

/** A parsed command file: its registered name, list description, and prompt body. */
interface CommandFile {
	/** Command name below the prefix, e.g. `promote` or `review:plan`. */
	name: string;
	/** Frontmatter `description`, else the body's first line, else the path. */
	description: string;
	/** The prompt text sent to the conversation. */
	body: string;
}

/** Load one command file; unreadable or misnamed files are skipped. */
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

/** Split an optional frontmatter block off; everything after it is the body. */
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

/** Command description: frontmatter `description` (unquoted), else the first body line. */
function describe(frontmatter: string, body: string): string {
	const declared = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
	if (declared) return declared;
	return body.split("\n").find((line) => line.trim())?.trim() ?? "";
}

/** Command-name legal character set; anything else is mapped to `-`. */
function sanitizeSegment(segment: string): string {
	return segment.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Walk `dir` collecting (name, path) pairs, depth-capped, files only. */
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

/** Compose the prompt to send: `$ARGUMENTS` substitution, else the typed text appended. */
export function composePrompt(body: string, args: string): string {
	const typed = args.trim();
	if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", typed);
	return typed ? `${body}\n\n${typed}` : body;
}

export default function (pi: ExtensionAPI) {
	markExtensionLoaded("commands");

	// The cwd is fixed for the process lifetime, so scanning here reads the
	// project the session runs in; new files require `/reload`, same as every
	// other on-disk prompt source.
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

/** Register one file as `/cmd:<name>`; the handler sends the prompt as the user. */
function registerPromptCommand(pi: ExtensionAPI, command: CommandFile, path: string): void {
	pi.registerCommand(`${COMMAND_PREFIX}${command.name}`, {
		description: command.description || `prompt command from ${path}`,
		handler: async (args) => {
			await pi.sendUserMessage(composePrompt(command.body, args));
		},
	});
}
