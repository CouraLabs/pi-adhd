import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { AGY_PROVIDER_ID } from "../../../shared/modes.ts";
import { disposeAgySession, handleAgySessionTree, streamAgyTurn } from "./bridge.ts";
import { registerAgyCommands } from "./commands.ts";
import { AGY_API_ID, AGY_BASE_URL, AGY_SYNC_ENTRY_TYPE, latestAgySyncRecord } from "./identity.ts";
import { fetchAgyModels, staticAgyModels } from "./models.ts";
import { registerAgySessionHost } from "./session-host.ts";
import type { AgySessionHost } from "./session-host.ts";

const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function streamSimple(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) {
	const stream = createAssistantMessageEventStream();
	streamAgyTurn(model, context, options, stream);
	return stream;
}

function installSessionHost(pi: ExtensionAPI): void {
	const lastPersisted = new Map<string, string>();

	const hostFor = (context: ExtensionContext): AgySessionHost => {
		const sessionKey = context.sessionManager.getSessionId();
		return {
			cwd: context.sessionManager.getCwd(),
			persistRecord: (record) => {
				const serialized = JSON.stringify(record);
				if (lastPersisted.get(sessionKey) === serialized) return;
				lastPersisted.set(sessionKey, serialized);
				pi.appendEntry(AGY_SYNC_ENTRY_TYPE, record);
			},
		};
	};

	pi.on("session_start", (_event, context) => {
		registerAgySessionHost(context.sessionManager.getSessionId(), hostFor(context), latestAgySyncRecord(context.sessionManager.getBranch()));
	});
	pi.on("session_tree", (_event, context) => {
		handleAgySessionTree(context.sessionManager.getSessionId(), hostFor(context));
	});
}

export default function registerAgyProvider(pi: ExtensionAPI): void {
	markExtensionLoaded("agy");

	pi.registerProvider(AGY_PROVIDER_ID, {
		name: "Antigravity",
		baseUrl: AGY_BASE_URL,
		apiKey: "agy-cli-managed",
		api: AGY_API_ID,
		streamSimple,
		models: staticAgyModels().map((model) => ({
			...model,
			reasoning: true,
			cost: NO_COST,
		})),
		refreshModels: async () => {
			const live = await fetchAgyModels();
			return live.map((model) => ({ ...model, reasoning: true, cost: NO_COST }));
		},
	});

	installSessionHost(pi);
	registerAgyCommands(pi);

	pi.on("session_shutdown", (_event, context) => {
		disposeAgySession(context.sessionManager.getSessionId());
	});
}
