import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { removeFrontmatterValue, writeFrontmatterValue } from "../config/agent-frontmatter.ts";
import { THINKING_LEVELS } from "../config/thinking-level.ts";
import type { AgentConfig } from "../types.ts";

export interface SpawnDefaultsUI {
	select(title: string, options: string[]): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface DefaultsToast {
	message: string;
	level: "info" | "warning" | "error";
}

export interface AgentDefaults {
	model?: string;
	thinking?: string;
}

export interface SpawnDefaultsParams {
	ui: SpawnDefaultsUI;

	listAgents: () => readonly AgentConfig[];
	cwd: string;

	models: readonly Model<any>[];

	getBuiltInModels: () => Record<string, string>;

	getBuiltInThinking: () => Record<string, string>;

	setAgentModel: (agentName: string, modelId: string | undefined) => DefaultsToast;

	setAgentThinking: (agentName: string, thinking: string | undefined) => DefaultsToast;

	reload: () => void;
}

type SourceLabel = "built-in" | "project" | "global";

const SOURCE_RANK: Record<SourceLabel, number> = { "built-in": 0, project: 1, global: 2 };

interface AgentEntry {
	label: string;
	agent: AgentConfig;
}

function sourceLabel(agent: AgentConfig): SourceLabel {
	if (agent.source === "project") return "project";
	if (agent.source === "global") return "global";
	return "built-in";
}

function isBuiltIn(agent: AgentConfig): boolean {
	return agent.source === undefined || agent.source === "default";
}

const INHERIT_OPTION = "Inherit (clear override)";

function annotate(agent: AgentConfig, defaults: AgentDefaults): string {
	const parts: string[] = [];
	if (defaults.model) parts.push(`model: ${defaults.model}`);
	if (defaults.thinking) parts.push(`thinking: ${defaults.thinking}`);
	const tail = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
	return `${agent.name} — ${sourceLabel(agent)}${tail}`;
}

export class SpawnDefaultsHandler {
	async handle(params: SpawnDefaultsParams): Promise<void> {
		const { ui } = params;

		for (;;) {
			const agents = [...params.listAgents()]
				.sort((a, b) => {
					const rank = SOURCE_RANK[sourceLabel(a)] - SOURCE_RANK[sourceLabel(b)];
					return rank !== 0 ? rank : a.name.localeCompare(b.name);
				});
			if (agents.length === 0) {
				ui.notify("No agents are available.", "info");
				return;
			}

			const entries = agents.map(
				(agent): AgentEntry => ({
					label: annotate(
						agent,
						isBuiltIn(agent)
							? {
									model: params.getBuiltInModels()[agent.name],
									thinking: params.getBuiltInThinking()[agent.name],
								}
							: { model: agent.model, thinking: agent.thinking },
					),
					agent,
				}),
			);

			const agentChoice = await ui.select("Spawn defaults — esc to exit", entries.map((e) => e.label));
			if (!agentChoice) return;
			const entry = entries.find((candidate) => candidate.label === agentChoice);
			if (!entry) return;

			for (;;) {
				const current = isBuiltIn(entry.agent)
					? {
							model: params.getBuiltInModels()[entry.agent.name],
							thinking: params.getBuiltInThinking()[entry.agent.name],
						}
					: { model: entry.agent.model, thinking: entry.agent.thinking };

				const action = await ui.select(`Defaults for ${entry.agent.name}`, [
					`Model: ${current.model ?? "inherit"}`,
					`Thinking: ${current.thinking ?? "inherit"}`,
					"Done",
				]);
				if (!action || action === "Done") break;

				if (action.startsWith("Model:")) {
					const chosen = await this.pickModel(params, entry.agent, current.model);
					if (chosen === "inherit") {
						const toast = this.persist(params, entry.agent, "model", undefined);
						ui.notify(toast.message, toast.level);
						break;
					}
					if (!chosen) break;

					const toast = this.persist(
						params,
						entry.agent,
						"model",
						`${chosen.provider}/${chosen.id}`,
					);
					ui.notify(toast.message, toast.level);

					const thinkingToast = await this.pickThinking(
						params,
						entry.agent,
						current.thinking,
						chosen,
					);
					if (thinkingToast) ui.notify(thinkingToast.message, thinkingToast.level);
					break;
				}

				if (action.startsWith("Thinking:")) {

					const model = current.model
						? params.models.find((m) => `${m.provider}/${m.id}` === current.model)
						: undefined;
					const toast = await this.pickThinking(params, entry.agent, current.thinking, model);
					if (toast) ui.notify(toast.message, toast.level);
					break;
				}

			}
		}
	}

	private async pickModel(
		params: SpawnDefaultsParams,
		agent: AgentConfig,
		current: string | undefined,
	): Promise<Model<any> | "inherit" | undefined> {
		const { ui } = params;

		const models = [...params.models].sort((a, b) =>
			`${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`),
		);
		if (models.length === 0) {
			ui.notify("No models are available.", "info");
			return undefined;
		}

		const options: { label: string; value: Model<any> | "inherit" }[] = current
			? [{ label: INHERIT_OPTION, value: "inherit" }]
			: [];
		for (const model of models) {
			const id = `${model.provider}/${model.id}`;
			options.push({ label: id === current ? `${id} — current` : id, value: model });
		}

		const choice = await ui.select(`Model for ${agent.name}`, options.map((o) => o.label));
		if (!choice) return undefined;
		const picked = options.find((o) => o.label === choice);
		if (!picked) return undefined;

		return picked.value;
	}

	private async pickThinking(
		params: SpawnDefaultsParams,
		agent: AgentConfig,
		current: string | undefined,
		model?: Model<any>,
	): Promise<DefaultsToast | undefined> {
		const { ui } = params;

		const levels = model ? getSupportedThinkingLevels(model) : [...THINKING_LEVELS];
		const options: { label: string; value: string | undefined }[] = current
			? [{ label: INHERIT_OPTION, value: undefined }]
			: [];
		for (const level of levels) {
			options.push({ label: level === current ? `${level} — current` : level, value: level });
		}

		const choice = await ui.select(`Thinking level for ${agent.name}`, options.map((o) => o.label));
		if (!choice) return undefined;
		const picked = options.find((o) => o.label === choice);
		if (!picked) return undefined;

		return this.persist(params, agent, "thinking", picked.value);
	}

	private persist(
		params: SpawnDefaultsParams,
		agent: AgentConfig,
		key: "model" | "thinking",
		value: string | undefined,
	): DefaultsToast {
		if (isBuiltIn(agent)) {
			return key === "model"
				? params.setAgentModel(agent.name, value)
				: params.setAgentThinking(agent.name, value);
		}

		const path =
			agent.source === "project"
				? join(params.cwd, ".agents", "agents", `${agent.name}.md`)
				: join(homedir(), ".agents", "agents", `${agent.name}.md`);
		try {
			const content = readFileSync(path, "utf8");
			const next = value === undefined ? removeFrontmatterValue(content, key) : writeFrontmatterValue(content, key, value);
			writeFileSync(path, next, "utf8");
		} catch (error) {
			return { message: `Could not write ${key} to ${path}: ${errorMessage(error)}`, level: "error" };
		}
		params.reload();
		return {
			message:
				value === undefined
					? `Removed ${key} from ${path}.`
					: `Wrote ${key}: ${value} to ${path}.`,
			level: "info",
		};
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
