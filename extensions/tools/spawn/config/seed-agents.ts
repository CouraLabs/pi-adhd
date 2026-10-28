import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { debugLog } from "../debug.ts";
import { AGENTS_INITIALIZED_MARKER } from "./agent-dirs.ts";

export interface SeedFile {
	name: string;
	content: string;
}

export function provisionDefaultAgents(targetDir: string, seeds: readonly SeedFile[], legacyDir?: string): void {
	const markerPath = join(targetDir, AGENTS_INITIALIZED_MARKER);
	if (existsSync(markerPath)) return;
	mkdirSync(targetDir, { recursive: true });
	for (const seed of seeds) {
		const destinationPath = join(targetDir, `${seed.name}.md`);
		if (existsSync(destinationPath)) continue;
		writeFileSync(destinationPath, resolveSeedContent(seed, legacyDir), "utf8");
	}
	writeFileSync(markerPath, "", "utf8");
	if (legacyDir) deleteLegacyDir(legacyDir);
}

function deleteLegacyDir(legacyDir: string): void {
	try {
		rmSync(legacyDir, { recursive: true, force: true });
	} catch (err) {
		debugLog("deleteLegacyDir", err);
	}
}

function resolveSeedContent(seed: SeedFile, legacyDir?: string): string {
	if (!legacyDir) return seed.content;
	const legacyPath = join(legacyDir, `${seed.name}.md`);
	if (!existsSync(legacyPath)) return seed.content;
	const legacyBody = readFileSync(legacyPath, "utf8").trim();
	if (!legacyBody) return seed.content;
	return `---\n${extractFrontmatterBlock(seed.content)}\n---\n\n${legacyBody}\n`;
}

function extractFrontmatterBlock(seedContent: string): string {
	const { body } = parseFrontmatter(seedContent);
	const trimmedBody = body.trim();
	const bodyStart = trimmedBody ? seedContent.lastIndexOf(trimmedBody) : seedContent.length;
	return seedContent
		.slice(0, bodyStart)
		.replace(/^---\r?\n/, "")
		.replace(/\r?\n+---\r?\n*$/, "");
}
