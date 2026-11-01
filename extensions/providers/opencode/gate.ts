import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFindToolDefinition } from "@earendil-works/pi-coding-agent";
import { OPENCODE_FREE_ID, OPENCODE_GATE_TOOLS } from "./identity.ts";

function registerGlobAlias(pi: ExtensionAPI): void {
	try {
		const existing = new Set(pi.getAllTools().map((tool) => tool.name));
		if (existing.has(OPENCODE_GATE_TOOLS[0]) || !existing.has("find")) return;
		const find = createFindToolDefinition(process.cwd());
		pi.registerTool({ ...find, name: OPENCODE_GATE_TOOLS[0], label: OPENCODE_GATE_TOOLS[0] });
	} catch {
		return;
	}
}

export function registerOpencodeGateTools(pi: ExtensionAPI): void {
	registerGlobAlias(pi);
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.model?.provider !== OPENCODE_FREE_ID) return;
		for (const name of OPENCODE_GATE_TOOLS) {
			if (!event.systemPromptOptions.selectedTools.includes(name)) event.systemPromptOptions.selectedTools.push(name);
		}
	});
}
