export interface GitInfo {

	branch: string | null;

	additions: number;

	removals: number;
}

export function emptyGit(): GitInfo {
	return { branch: null, additions: 0, removals: 0 };
}

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
