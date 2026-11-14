import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export function findExecutable(name: string, extraPaths: readonly string[] = []): string | undefined {
	const suffixes = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
	const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	for (const directory of directories) {
		for (const suffix of suffixes) {
			const candidate = join(directory, name + suffix);
			if (isExecutable(candidate)) return candidate;
		}
	}
	return extraPaths.find(isExecutable);
}
