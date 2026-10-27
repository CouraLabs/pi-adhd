import type { AgentConfig } from "../types.ts";

export interface AgentConfigLookup {
	resolveAgentConfig(type: string): AgentConfig | undefined;
	getToolNamesForType(type: string, parentToolNames: readonly string[]): string[];
}

export class AgentTypeRegistry implements AgentConfigLookup {
	private agents = new Map<string, AgentConfig>();

	constructor(private readonly loadAgents: () => Map<string, AgentConfig>) {
		this.reload();
	}

	reload(): void {
		this.agents = new Map(this.loadAgents());
	}

	resolveType(name: string): string | undefined {
		return this.resolveKey(name);
	}

	getAvailableTypes(): string[] {
		return [...this.agents.entries()]
			.filter(([, config]) => config.enabled !== false)
			.map(([name]) => name);
	}

	list(): AgentConfig[] {
		return [...this.agents.values()];
	}

	isValidType(type: string): boolean {
		const key = this.resolveKey(type);
		if (!key) return false;
		return this.agents.get(key)?.enabled !== false;
	}

	getToolNamesForType(type: string, parentToolNames: readonly string[]): string[] {
		const config = this.resolveAgentConfig(type);
		if (!config) return [...BUILTIN_TOOL_NAMES];
		if (config.allTools) return [...parentToolNames];
		if (config.toolNames) return [...config.toolNames];
		return [...BUILTIN_TOOL_NAMES];
	}

	resolveAgentConfig(type: string): AgentConfig | undefined {
		const key = this.resolveKey(type);
		const config = key ? this.agents.get(key) : undefined;
		if (config) return config;

		const generalPurpose = this.agents.get("general-purpose");
		if (generalPurpose && generalPurpose.enabled !== false) return generalPurpose;
		return undefined;
	}

	private resolveKey(name: string): string | undefined {
		if (this.agents.has(name)) return name;
		const lower = name.toLowerCase();
		for (const key of this.agents.keys()) {
			if (key.toLowerCase() === lower) return key;
		}
		return undefined;
	}
}

export const BUILTIN_TOOL_NAMES: string[] = ["read", "bash", "edit", "write", "grep", "find", "ls"];
