/**
 * spawn-defaults.ts — the `/spawn:model` command: a looping picker that
 * sets a spawned agent's default model and thinking level, and shows what is already
 * set while it does.
 *
 * The dialog loops: pick an agent, choose what to set (model or thinking), and
 * the agent list comes back with the new value annotated, so the operator can
 * verify the write without reopening the command. Esc at the agent list exits.
 *
 * Built-in agents (`general-purpose`, `plan-reviewer`, `Arquitect`,
 * `Code-Review`, `Explore`) have no markdown file, so their choices are stored
 * in the pi-adhd settings file (`spawn.agentModels` / `spawn.agentThinking`).
 * A custom agent loaded from `.agents/agents/*.md` gets `model:` / `thinking:`
 * written into its own frontmatter instead, and the registry is reloaded so the
 * annotation reflects the file immediately.
 *
 * The handler takes a narrow injected UI (the same shape `SessionNavigatorHandler`
 * uses) so it stays unit-testable and free of the SDK surface.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { removeFrontmatterValue, writeFrontmatterValue } from "../config/agent-frontmatter.ts";
import { THINKING_LEVELS } from "../config/thinking-level.ts";
import type { AgentConfig } from "../types.ts";

/** The slice of the extension UI the pickers need. */
export interface SpawnDefaultsUI {
	select(title: string, options: string[]): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** The toast a persistence helper returns; the handler displays it verbatim. */
export interface DefaultsToast {
	message: string;
	level: "info" | "warning" | "error";
}

/** What an agent currently runs with, as the picker annotates it. */
export interface AgentDefaults {
	model?: string;
	thinking?: string;
}

export interface SpawnDefaultsParams {
	ui: SpawnDefaultsUI;
	/**
	 * Every agent the registry knows, re-read each loop pass so a custom agent's
	 * fresh frontmatter annotates immediately after a write + reload.
	 */
	listAgents: () => readonly AgentConfig[];
	cwd: string;
	/** Auth-configured models, already resolved by the caller. */
	models: readonly Model<any>[];
	/** Live view of the built-in agents' persisted model overrides. */
	getBuiltInModels: () => Record<string, string>;
	/** Live view of the built-in agents' persisted thinking overrides. */
	getBuiltInThinking: () => Record<string, string>;
	/** Persist a built-in agent's model; `undefined` clears the override. */
	setAgentModel: (agentName: string, modelId: string | undefined) => DefaultsToast;
	/** Persist a built-in agent's thinking level; `undefined` clears the override. */
	setAgentThinking: (agentName: string, thinking: string | undefined) => DefaultsToast;
	/**
	 * Re-scan custom agent files after a frontmatter write, so the next pass
	 * annotates from the file rather than a stale config.
	 */
	reload: () => void;
}

/** Where an agent came from, as the picker labels it. */
type SourceLabel = "built-in" | "project" | "global";

/** Display order of the source groups. */
const SOURCE_RANK: Record<SourceLabel, number> = { "built-in": 0, project: 1, global: 2 };

/** One selectable agent, with its group-qualified, defaults-annotated label. */
interface AgentEntry {
	label: string;
	agent: AgentConfig;
}

/** `source` narrows to the picker's three groups; anything else reads as a built-in. */
function sourceLabel(agent: AgentConfig): SourceLabel {
	if (agent.source === "project") return "project";
	if (agent.source === "global") return "global";
	return "built-in";
}

/** A built-in has no file of its own, so its choices live in the settings maps. */
function isBuiltIn(agent: AgentConfig): boolean {
	return agent.source === undefined || agent.source === "default";
}

/** The picker entry that clears an override instead of naming a value. */
const INHERIT_OPTION = "Inherit (clear override)";

/** Annotate an agent's label with the defaults it currently runs with. */
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

		// The loop IS the feature: after every set, the list re-renders with the
		// fresh values, so the operator sees the write land without reopening.
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

			// Inner loop: one agent's action menu, until Done or esc returns to the list.
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
					if (!chosen) break; // esc or nothing available changes nothing

					const toast = this.persist(
						params,
						entry.agent,
						"model",
						`${chosen.provider}/${chosen.id}`,
					);
					ui.notify(toast.message, toast.level);
					// Straight to the thinking picker, filtered to what the chosen
					// model supports. Esc there keeps the model and leaves thinking
					// untouched.
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
					// Filter to what the agent's already-set model supports, when that
					// model resolves among the available ones; otherwise all levels.
					const model = current.model
						? params.models.find((m) => `${m.provider}/${m.id}` === current.model)
						: undefined;
					const toast = await this.pickThinking(params, entry.agent, current.thinking, model);
					if (toast) ui.notify(toast.message, toast.level);
					break;
				}

				// An unrecognized label (a future option) reopens the menu rather
				// than silently exiting.
			}
		}
	}

	/**
	 * Show the model picker for one agent. Returns the chosen model (persisted by
	 * the caller), the string "inherit" when the override was cleared, or
	 * undefined when esc was pressed or nothing is available.
	 */
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
		if (!choice) return undefined; // esc changes nothing; the agent list returns
		const picked = options.find((o) => o.label === choice);
		if (!picked) return undefined;

		return picked.value;
	}

	/**
	 * Show the thinking-level picker for one agent; a choice persists and returns its toast.
	 *
	 * When `model` is given, only the levels that model supports are offered —
	 * `getSupportedThinkingLevels` reads the model's `reasoning` flag and
	 * `thinkingLevelMap`, so a level the model cannot express is never offered.
	 */
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
		if (!choice) return undefined; // esc changes nothing; the agent list returns
		const picked = options.find((o) => o.label === choice);
		if (!picked) return undefined;

		return this.persist(params, agent, "thinking", picked.value);
	}

	/**
	 * Route one picked value to its store: the settings maps for a built-in, the
	 * agent's own frontmatter file for a custom one. Returns the toast to display.
	 */
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

/** A caught value's message, for an error notification. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
