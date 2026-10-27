import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function getUserPromptsDir(): string {
	return join(dirname(getAgentDir()), "couralabs", "prompts");
}

export function offloadPrompt(folder: string, file: string, packagedContent: string): string {
	const dir = join(getUserPromptsDir(), folder);
	const path = join(dir, file);
	try {
		if (!existsSync(path)) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(path, packagedContent, "utf8");
		}
	} catch {

	}
	return path;
}

export function readUserPrompt(folder: string, file: string, packagedContent: string): string {
	try {
		const path = join(getUserPromptsDir(), folder, file);
		const text = existsSync(path) ? readFileSync(path, "utf8") : "";
		return text.trim() ? text : packagedContent;
	} catch {
		return packagedContent;
	}
}
