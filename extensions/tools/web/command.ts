/**
 * command.ts — the `/web` command: pick the default fetch and search providers,
 * persisted in the pi-tdah settings file.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getFetchConfig, getSearchConfig, saveFetchConfig, saveSearchConfig, type WebProviderConfig } from "./config.ts";
import { listAllFetchProviders } from "./providers.ts";
import { listAllSearchProviders } from "./search-providers.ts";

type ProviderRow = { id: string; configured: boolean; env: string[] };

interface Service {
	kind: "fetch" | "search";
	section: string;
	getConfig: () => WebProviderConfig;
	save: (patch: Partial<WebProviderConfig>) => void;
	providers: () => ProviderRow[];
	order: string[];
}

const SERVICES: Service[] = [
	{
		kind: "fetch",
		section: "Web fetch",
		getConfig: getFetchConfig,
		save: saveFetchConfig,
		providers: listAllFetchProviders,
		order: ["curl", "jina-reader", "9router"],
	},
	{
		kind: "search",
		section: "Web search",
		getConfig: getSearchConfig,
		save: saveSearchConfig,
		providers: listAllSearchProviders,
		order: [
			"searxng",
			"9router",
			"exa",
			"tavily",
			"perplexity",
			"serper",
			"brave-search",
			"youcom",
			"google-pse",
			"searchapi",
			"linkup",
			"xquik",
			"ollama-search",
		],
	},
];

/** The "auto" pseudo-provider plus every registered one, in display order. */
function providerRows(service: Service): ProviderRow[] {
	const rank = (id: string) => {
		const index = service.order.indexOf(id);
		return index === -1 ? service.order.length : index;
	};
	const providers = service.providers().sort((a, b) => rank(a.id) - rank(b.id));
	return [{ id: "auto", configured: true, env: [] }, ...providers];
}

/** One select option: the id, with the missing env vars named when unconfigured. */
function optionLabel(row: ProviderRow): string {
	return row.configured || row.id === "auto" ? row.id : `${row.id} · set ${row.env.join(", ")}`;
}

async function editService(ctx: ExtensionContext, service: Service): Promise<void> {
	const config = service.getConfig();

	// Provider: every registered provider, plus "auto" (first configured wins).
	const rows = providerRows(service);
	const labels = rows.map(optionLabel);
	const current = rows.findIndex((row) => row.id === config.provider);
	const chosen = await ctx.ui.select(
		`${service.section} provider`,
		current >= 0 ? [...labels.slice(0, current), ...labels.slice(current + 1), labels[current]] : labels,
	);
	if (!chosen) return;
	const picked = rows.find((row) => optionLabel(row) === chosen) ?? rows[rows.length - 1];
	service.save({ provider: picked.id });
	ctx.ui.notify(`${service.section} provider set to ${picked.id}`, "info");
}

export function registerWebCommand(pi: ExtensionAPI): void {
	pi.registerCommand("web", {
		description: "Set the default web fetch and search providers",
		handler: async (_args, ctx) => {
			for (const service of SERVICES) {
				await editService(ctx, service);
			}
		},
	});
}
