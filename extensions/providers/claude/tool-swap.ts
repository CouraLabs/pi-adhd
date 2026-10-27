import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MIRROR_TOOL_NAMES } from "./mirror-tools.ts";
import { CLAUDE_PROVIDER_ID } from "../../../shared/modes.ts";

const PI_TOOLS_REPLACED_BY_SDK: readonly string[] = [
	"read",
	"write",
	"edit",
	"bash",
	"grep",
	"find",
	"ls",
	"webfetch",
	"websearch",
	"job",
	"job-kill",
	"job-read",
	"job-list",
	"spawn",
	"ask",
];

export function retargetToolSet(tools: readonly string[], knownNames: ReadonlySet<string>, towardClaude: boolean): string[] {
	const replaced = new Set(PI_TOOLS_REPLACED_BY_SDK);
	const mirrors = new Set<string>(MIRROR_TOOL_NAMES);
	if (towardClaude) {
		const hadReplaced = tools.some((name) => replaced.has(name));
		const kept = tools.filter((name) => !replaced.has(name) && !mirrors.has(name));
		return hadReplaced ? [...kept, ...MIRROR_TOOL_NAMES] : [...kept, ...tools.filter((name) => mirrors.has(name))];
	}
	const kept = tools.filter((name) => !mirrors.has(name));
	const hadMirrors = kept.length !== tools.length;
	if (!hadMirrors) return kept;
	return [...kept, ...PI_TOOLS_REPLACED_BY_SDK.filter((name) => knownNames.has(name) && !kept.includes(name))];
}

export function installToolSwap(pi: ExtensionAPI): void {
	const mirrorNames = new Set(MIRROR_TOOL_NAMES);
	const replacedNames = new Set(PI_TOOLS_REPLACED_BY_SDK);
	let disabledBySwap: string[] = [];

	const enterClaudeTools = (): void => {
		const active = pi.getActiveTools();
		const removed = active.filter((name) => replacedNames.has(name));
		disabledBySwap = [...new Set([...disabledBySwap, ...removed])];
		const kept = active.filter((name) => !replacedNames.has(name) && !mirrorNames.has(name));
		pi.setActiveTools([...kept, ...MIRROR_TOOL_NAMES]);
	};

	const leaveClaudeTools = (): void => {
		const active = pi.getActiveTools();
		const mirrorsActive = active.some((name) => mirrorNames.has(name));
		if (!mirrorsActive && disabledBySwap.length === 0) return;
		const knownNames = new Set(pi.getAllTools().map((tool) => tool.name));
		const toRestore = disabledBySwap.length > 0 ? disabledBySwap : PI_TOOLS_REPLACED_BY_SDK;
		const kept = active.filter((name) => !mirrorNames.has(name));
		const restored = toRestore.filter((name) => knownNames.has(name) && !kept.includes(name));
		disabledBySwap = [];
		pi.setActiveTools([...kept, ...restored]);
	};

	const syncToModel = (provider: string | undefined): void => {
		if (provider === CLAUDE_PROVIDER_ID) enterClaudeTools();
		else leaveClaudeTools();
	};

	pi.on("session_start", (_event, context) => {
		syncToModel(context.model?.provider);
	});
	pi.on("model_select", (event) => {
		syncToModel(event.model.provider);
	});
}
