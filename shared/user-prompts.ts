/**
 * user-prompts — packaged prompt assets offloaded to an editable folder.
 *
 * Shipped prompts (`work.md`, the submode prompts, the subagent system
 * prompts) live inside the installed package, where a user cannot reasonably
 * edit them. When the owning extension loads it copies each asset — once — to
 * `~/.pi/couralabs/prompts/<folder>/<file>` and reads its prompt from there
 * afterwards, so edits on disk take effect on the next run (or `/reload`)
 * without touching the package.
 *
 * Files are written only when missing: an existing file is user state and is
 * never overwritten. Deleting a file restores the packaged version on the
 * next load.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Path of the user-editable prompt folder (`~/.pi/couralabs/prompts`). */
export function getUserPromptsDir(): string {
	return join(dirname(getAgentDir()), "couralabs", "prompts");
}

/**
 * Copy a packaged prompt to the user folder when it is not there yet and
 * return the file's path. Idempotent; existing files are never overwritten.
 *
 * The offload is an optimization, not a requirement: when the user folder is
 * not writable the failure is contained and the packaged content stays the
 * effective prompt (readers fall back to it), so an unwritable `~/.pi` must
 * never abort the owning extension's load.
 */
export function offloadPrompt(folder: string, file: string, packagedContent: string): string {
	const dir = join(getUserPromptsDir(), folder);
	const path = join(dir, file);
	try {
		if (!existsSync(path)) {
			mkdirSync(dir, { recursive: true });
			writeFileSync(path, packagedContent, "utf8");
		}
	} catch {
		// Unwritable home, disk full, sandbox: keep the packaged prompt working.
	}
	return path;
}

/**
 * Read a user-editable prompt. Returns the packaged content when the file is
 * missing, unreadable, or empty (whitespace only), so a hand-deleted or
 * hand-blanked file degrades to the default rather than to an empty system
 * prompt.
 */
export function readUserPrompt(folder: string, file: string, packagedContent: string): string {
	try {
		const path = join(getUserPromptsDir(), folder, file);
		const text = existsSync(path) ? readFileSync(path, "utf8") : "";
		return text.trim() ? text : packagedContent;
	} catch {
		return packagedContent;
	}
}
