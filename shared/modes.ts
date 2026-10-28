import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { MODE_CLAUDE, MODE_CUSTOM, MODE_PI, MODE_WORK } from "./glyphs.ts";
import { parseModeFile } from "./mode-frontmatter.ts";
import { getUserPromptsDir } from "./user-prompts.ts";
import { createGlobalStore } from "./store.ts";

export const PI_MODE = "pi";

export const CLAUDE_MODE = "claude";

export type AgentMode = string;

export type SelectableAgentMode = AgentMode;

export const CLAUDE_PROVIDER_ID = "claude";

export function isClaudeProvider(provider: string | undefined): boolean {
	return provider === CLAUDE_PROVIDER_ID;
}

export const DEFAULT_AGENT_MODE: SelectableAgentMode = "work";

export function userModesDir(): string {
	return join(getUserPromptsDir(), "modes");
}

export function listAgentModes(): AgentMode[] {
	const names: string[] = [];
	try {
		if (existsSync(userModesDir())) {
			for (const file of readdirSync(userModesDir())) {
				if (file.endsWith(".md")) names.push(file.slice(0, -3));
			}
		}
	} catch {

	}
	return [...new Set([...names, PI_MODE])]
		.filter((name) => name.toLowerCase() !== CLAUDE_MODE)
		.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function nextAgentMode(current: AgentMode, modes: readonly AgentMode[]): AgentMode {

	return modes[(modes.indexOf(current) + 1) % modes.length];
}

interface ModeDeclaration {
	model?: string;
	error?: string;
}

function readModeFile(mode: AgentMode): string | undefined {
	try {
		const path = join(userModesDir(), `${mode}.md`);
		return existsSync(path) ? readFileSync(path, "utf8") : undefined;
	} catch {
		return undefined;
	}
}

export function readModePrompt(mode: AgentMode): string | undefined {
	const text = readModeFile(mode);
	if (text === undefined) return undefined;
	const parsed = parseModeFile(text);
	if ("error" in parsed) return undefined;
	return parsed.body.trim() ? parsed.body : undefined;
}

export function readModeDeclaration(mode: AgentMode): ModeDeclaration | undefined {
	const text = readModeFile(mode);
	if (text === undefined) return undefined;
	const parsed = parseModeFile(text);
	if ("error" in parsed) return { error: `${join(userModesDir(), `${mode}.md`)}: ${parsed.error}` };
	return { model: parsed.frontmatter.model };
}

function modeDisplayName(mode: AgentMode): string {
	return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function agentModeLabel(mode: AgentMode): string {
	if (mode === PI_MODE) return `${MODE_PI} Pi`;
	if (mode === CLAUDE_MODE) return `${MODE_CLAUDE} Claude`;
	if (mode === "work") return `${MODE_WORK} Work`;
	return `${MODE_CUSTOM} ${modeDisplayName(mode)}`;
}

export function modeNotice(mode: AgentMode): string {
	if (mode === PI_MODE) {
		return `${agentModeLabel(mode)}. pi's default system prompt is in effect — no pi-adhd rules are added, so the agent answers in its own voice with pi's built-in guidance and the full toolset.`;
	}
	if (mode === CLAUDE_MODE) {
		return `${agentModeLabel(mode)}. The Claude Agent SDK drives the run with its own system prompt; the pi-adhd Work rules are not used and submodes are appended to it. Switching to a non-Claude model restores the previous mode.`;
	}
	return `${agentModeLabel(mode)}. The pi-adhd mode '${mode}' replace Pi's default system prompt.`;
}

const store = createGlobalStore<AgentMode>(Symbol.for("@couralabs/pi-adhd/agent-mode"), DEFAULT_AGENT_MODE);

export function getAgentMode(): AgentMode {
	return store.get();
}

export function setAgentMode(mode: AgentMode): void {
	store.set(mode);
}

export function subscribeAgentMode(listener: (mode: AgentMode) => void): () => void {
	return store.subscribe(listener);
}

export const MODE_STATE_ENTRY_TYPE = "mode-state";

export function isAgentMode(value: unknown): value is AgentMode {
	return typeof value === "string" && value.trim() !== "";
}

export interface ModeSnapshot {
	mode: AgentMode;
	previousMode?: SelectableAgentMode;
}

export function isSelectableAgentMode(value: unknown): value is SelectableAgentMode {
	return isAgentMode(value) && value !== CLAUDE_MODE;
}

export function restoreModeSnapshotFromEntries(entries: readonly unknown[]): ModeSnapshot | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type?: string; customType?: string; data?: unknown } | undefined;
		if (!entry || entry.type !== "custom" || entry.customType !== MODE_STATE_ENTRY_TYPE) continue;
		const data = entry.data as { mode?: unknown; previousMode?: unknown } | undefined;
		if (!isAgentMode(data?.mode)) continue;
		return {
			mode: data.mode,
			previousMode: isSelectableAgentMode(data.previousMode) ? data.previousMode : undefined,
		};
	}
	return undefined;
}

export function agentModeColor(mode: AgentMode): ThemeColor {
	return mode === "work" ? "text" : "accent";
}

export function agentModeBorderColor(mode: AgentMode): ThemeColor {
	if (mode === PI_MODE) return "accent";
	return mode === "work" ? "border" : "borderAccent";
}
