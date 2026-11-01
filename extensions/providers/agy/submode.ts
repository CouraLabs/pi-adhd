import { SUBMODE_TOOLS, getSubmodePromptSections } from "../../../shared/submodes.ts";

function identityToolMap(): Map<string, string> {
	const names = new Set<string>();
	for (const tools of Object.values(SUBMODE_TOOLS)) {
		for (const name of tools) names.add(name);
	}
	names.add("plan-write");
	names.add("submode-exit");
	return new Map([...names].map((name) => [name, name]));
}

export function buildAgySubmodeAppend(): string | undefined {
	const sections = Object.entries(getSubmodePromptSections(identityToolMap()));
	if (sections.length === 0) return undefined;
	return sections.map(([tag, content]) => `<${tag}>\n${content}\n</${tag}>`).join("\n\n");
}
