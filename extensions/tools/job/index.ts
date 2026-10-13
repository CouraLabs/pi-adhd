/**
 * job — background terminal jobs for pi.
 *
 * Four tools (`job`, `job-kill`, `job-read`, `job-list`) and their matching
 * commands share one in-memory {@link JobManager}. The manager holds no state
 * until the first job starts, so constructing it in the factory is safe; the
 * idempotent `session_shutdown` handler kills every running job and empties the
 * registry, so a reload or session replacement never leaks a process.
 */

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
