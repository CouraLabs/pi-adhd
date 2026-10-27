import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markExtensionLoaded } from "../../../shared/extension-registry.ts";
import { registerJobCommands } from "./commands.ts";
import { JobManager } from "./manager.ts";
import { registerJobTools } from "./tools.ts";

export default function jobExtension(pi: ExtensionAPI): void {
	markExtensionLoaded("job");
	const manager = new JobManager();

	registerJobTools(pi, manager);
	registerJobCommands(pi, manager);

	pi.on("session_shutdown", () => {
		manager.disposeAll();
	});
}
