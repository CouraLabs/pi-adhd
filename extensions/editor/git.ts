/** Git status model for the editor's location segment. */

export interface GitInfo {
	/** Current branch, or null when detached or not in a repository. */
	branch: string | null;
	/** Lines added across staged and unstaged changes (`git diff` numstat). */
	additions: number;
	/** Lines removed across staged and unstaged changes (`git diff` numstat). */
	removals: number;
}

export function emptyGit(): GitInfo {
	return { branch: null, additions: 0, removals: 0 };
}

/** Sum the added/removed columns of `git diff --numstat` output. */
export function parseNumstat(stdout: string): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	for (const line of stdout.split("\n")) {
		if (!line) continue;
		const [added, removed] = line.split("\t");
		const addedCount = Number(added);
		const removedCount = Number(removed);
		if (Number.isFinite(addedCount)) additions += addedCount;
		if (Number.isFinite(removedCount)) removals += removedCount;
	}
	return { additions, removals };
}
