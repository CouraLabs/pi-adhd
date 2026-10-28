import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_INITIALIZED_MARKER } from "./agent-dirs.ts";

export interface SeedFile {
	name: string;
	content: string;
}

export function provisionDefaultAgents(targetDir: string, seeds: readonly SeedFile[]): void {
	const markerPath = join(targetDir, AGENTS_INITIALIZED_MARKER);
	if (existsSync(markerPath)) return;
	mkdirSync(targetDir, { recursive: true });
	for (const seed of seeds) {
		const destinationPath = join(targetDir, `${seed.name}.md`);
		if (existsSync(destinationPath)) continue;
		writeFileSync(destinationPath, seed.content, "utf8");
	}
	writeFileSync(markerPath, "", "utf8");
}
