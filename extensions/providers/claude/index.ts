import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { backgroundReportRenderer, BACKGROUND_REPORT_ENTRY_TYPE } from "./background-tasks.ts";
import { configurePiToolDescriptions, disposeClaudeSession, streamClaudeTurn } from "./bridge.ts";
import { registerClaudeCommands } from "./commands.ts";
import { CLAUDE_MODELS } from "./models.ts";
import { isPiOwnedToolName } from "./pi-mcp.ts";
import type { PiToolDescriptions } from "./pi-mcp.ts";
import { registerLimitHandoff } from "./limit-handoff/index.ts";
import { registerMirrorTools } from "./mirror-tools.ts";
import { registerSessionHost } from "./session-host.ts";
import { SYNC_ENTRY_TYPE, isSyncRecord } from "./session-sync.ts";
import type { SyncRecord } from "./session-sync.ts";
import { installToolSwap } from "./tool-swap.ts";
import { CLAUDE_PROVIDER_ID } from "../../../shared/modes.ts";
import { CLAUDE_API_ID } from "./translate.ts";

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function streamSimple(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	streamClaudeTurn(model, context, options, stream);
	return stream;
}

function latestSyncRecord(context: ExtensionContext): SyncRecord | undefined {
	const branch = context.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry.type === "custom" && entry.customType === SYNC_ENTRY_TYPE && isSyncRecord(entry.data)) return entry.data;
	}
	return undefined;
}

function installSessionHost(pi: ExtensionAPI): void {
	const lastPersisted = new Map<string, string>();

	const attach = (context: ExtensionContext): void => {
		const sessionKey = context.sessionManager.getSessionId();
		registerSessionHost(
			sessionKey,
			{
				cwd: context.sessionManager.getCwd(),
				interactive: context.hasUI,
				persistRecord: (record) => {
					const serialized = JSON.stringify(record);
					if (lastPersisted.get(sessionKey) === serialized) return;
					lastPersisted.set(sessionKey, serialized);
					pi.appendEntry(SYNC_ENTRY_TYPE, record);
				},
			},
			latestSyncRecord(context),
		);
	};

	pi.on("session_start", (_event, context) => attach(context));
	pi.on("session_tree", (_event, context) => attach(context));
}

export default function registerClaudeProvider(pi: ExtensionAPI): void {
	markExtensionLoaded("claude");

	pi.registerProvider(CLAUDE_PROVIDER_ID, {
		name: "Claude",
		baseUrl: "claude-agent-sdk://local",
		apiKey: "claude-agent-sdk-managed",
		api: CLAUDE_API_ID,
		streamSimple,
		models: CLAUDE_MODELS.map((model) => ({
			...model,
			reasoning: true,
			input: ["text", "image"],
			cost: NO_COST,
		})),
	});

	configurePiToolDescriptions(() => {
		const descriptions: PiToolDescriptions = {};
		for (const info of pi.getAllTools()) {
			if (isPiOwnedToolName(info.name)) descriptions[info.name] = info.description;
		}
		return descriptions;
	});
	registerMirrorTools(pi);
	installToolSwap(pi);
	installSessionHost(pi);
	registerClaudeCommands(pi);
	registerLimitHandoff(pi);
	pi.registerEntryRenderer(BACKGROUND_REPORT_ENTRY_TYPE, backgroundReportRenderer);

	pi.on("session_shutdown", (_event, context) => {
		disposeClaudeSession(context.sessionManager.getSessionId());
	});
}
