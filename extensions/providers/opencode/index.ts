import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { registerOpencodeGateTools } from "./gate.ts";
import { OPENCODE_FREE_ID, OPENCODE_GO_ID } from "./identity.ts";
import { currentFreeModels, freeProviderConfig, goProviderConfig, refreshFreeCatalog } from "./provider.ts";

export default function registerOpencode(pi: ExtensionAPI): void {
	markExtensionLoaded("opencode");
	pi.registerProvider(OPENCODE_FREE_ID, freeProviderConfig());
	pi.registerProvider(OPENCODE_GO_ID, goProviderConfig());
	registerOpencodeGateTools(pi);
	void refreshFreeCatalog().then(() => {
		try {
			if (currentFreeModels().length > 0) pi.registerProvider(OPENCODE_FREE_ID, freeProviderConfig());
		} catch {
			return;
		}
	});
}
