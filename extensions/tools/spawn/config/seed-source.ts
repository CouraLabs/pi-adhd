import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedFile } from "./seed-agents.ts";

export function loadPackagedSeedAgents(): SeedFile[] {
	const packagedDir = fileURLToPath(new URL("./default-agents/", import.meta.url));
	const filenames = readdirSync(packagedDir)
		.filter((filename) => filename.endsWith(".md"))
		.sort();
	return filenames.map((filename) => ({
		name: filename.replace(/\.md$/, ""),
		content: readFileSync(join(packagedDir, filename), "utf8"),
	}));
}
