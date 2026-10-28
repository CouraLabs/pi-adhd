import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const AGENTS_INITIALIZED_MARKER = ".initialized";

export function globalAgentsDir(): string {
	return join(dirname(getAgentDir()), "agents");
}

export function projectAgentsDir(cwd: string): string {
	return join(cwd, ".pi", "agents");
}
