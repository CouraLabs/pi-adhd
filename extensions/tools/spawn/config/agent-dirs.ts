import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const AGENTS_INITIALIZED_MARKER = ".initialized";

export function globalAgentsDir(): string {
	return join(dirname(getAgentDir()), "agents");
}

export function globalCommunityAgentsDir(): string {
	return join(dirname(dirname(getAgentDir())), ".agents", "agents");
}

export function projectAgentsDir(cwd: string): string {
	return join(cwd, ".pi", "agents");
}

export function projectCommunityAgentsDir(cwd: string): string {
	return join(cwd, ".agents", "agents");
}
