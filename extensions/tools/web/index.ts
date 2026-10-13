/**
 * web — provider-neutral `webfetch` and `websearch` tools for pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBuiltinProviders } from "./builtin.ts";
import { registerWebCommand } from "./command.ts";
import { registerBuiltinSearchProviders } from "./search-builtin.ts";
import { registerSearchTool } from "./websearch-tool.ts";
import { registerFetchTool } from "./webfetch-tool.ts";

export * from "./providers.ts";
export * from "./runner.ts";
export * from "./search-providers.ts";
export * from "./search-runner.ts";

export default function registerWeb(pi: ExtensionAPI): void {
	registerBuiltinProviders();
	registerBuiltinSearchProviders();
	registerWebCommand(pi);
	registerFetchTool(pi);
	registerSearchTool(pi);
}
