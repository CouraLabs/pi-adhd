/** Git status model and parser for `git status --porcelain=v2 --branch`. */

export interface GitInfo {
	branch: string | null;
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	deleted: number;
	renamed: number;
	untracked: number;
	conflicts: number;
}

export function emptyGit(): GitInfo {
	return {
		branch: null,
		ahead: 0,
		behind: 0,
		staged: 0,
		modified: 0,
		deleted: 0,
		renamed: 0,
		untracked: 0,
		conflicts: 0,
	};
}

export function parseGitStatus(stdout: string): GitInfo {
	const git = emptyGit();

	for (const line of stdout.split("\n")) {
		if (!line) continue;

		if (line.startsWith("# branch.head ")) {
			const head = line.slice("# branch.head ".length).trim();
			git.branch = head === "(detached)" ? null : head;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/);
			if (match) {
				git.ahead = Number(match[1]);
				git.behind = Number(match[2]);
			}
			continue;
		}
		if (line.startsWith("1 ")) {
			tallyStatus(git, line.slice(2, 4));
			continue;
		}
		if (line.startsWith("2 ")) {
			git.renamed++;
			tallyStatus(git, line.slice(2, 4));
			continue;
		}
		if (line.startsWith("u ")) {
			git.conflicts++;
			continue;
		}
		if (line.startsWith("? ")) {
			git.untracked++;
		}
	}

	return git;
}

function tallyStatus(git: GitInfo, xy: string): void {
	const [index, worktree] = [xy[0] ?? ".", xy[1] ?? "."];
	if (index === "A" || index === "M" || index === "R" || index === "C" || index === "T") git.staged++;
	if (worktree === "M" || worktree === "T") git.modified++;
	if (index === "D" || worktree === "D") git.deleted++;
}

export function gitChangeCount(git: GitInfo): number {
	return git.staged + git.modified + git.deleted + git.renamed;
}
