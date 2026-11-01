import { execFile } from "node:child_process";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { AGY_API_ID, AGY_BASE_URL, AGY_BINARY } from "./identity.ts";

export const STANDARD_CONTEXT_WINDOW = 200_000;

const MAX_OUTPUT_TOKENS = 64_000;

const FALLBACK_MODELS: ReadonlyArray<{ id: string; name: string }> = [
	{ id: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
	{ id: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" },
	{ id: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)" },
	{ id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
	{ id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
	{ id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
	{ id: "claude-opus-5-5-low", name: "Claude Opus 5.5 (Low)" },
	{ id: "claude-opus-5-5-medium", name: "Claude Opus 5.5 (Medium)" },
	{ id: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High)" },
	{ id: "claude-sonnet-5-5-low", name: "Claude Sonnet 5.5 (Low)" },
	{ id: "claude-sonnet-5-5-medium", name: "Claude Sonnet 5.5 (Medium)" },
	{ id: "claude-sonnet-5-5-high", name: "Claude Sonnet 5.5 (High)" },
	{ id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
];

export function parseAgyModelsOutput(stdout: string): Array<{ id: string; name: string }> {
	const models: Array<{ id: string; name: string }> = [];
	for (const rawLine of stdout.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("Fetching")) continue;
		const parts = line.split(/\t+|\s{2,}/);
		const id = parts[0]?.trim();
		if (!id || /\s/.test(id)) continue;
		const name = parts.slice(1).join(" ").trim() || id;
		models.push({ id, name });
	}
	return models;
}

function toModelConfig(id: string, name: string): ProviderModelConfig {
	return {
		id,
		name,
		api: AGY_API_ID,
		baseUrl: AGY_BASE_URL,
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: STANDARD_CONTEXT_WINDOW,
		maxTokens: MAX_OUTPUT_TOKENS,
	};
}

export function staticAgyModels(): ProviderModelConfig[] {
	return FALLBACK_MODELS.map((model) => toModelConfig(model.id, model.name));
}

function runAgyModels(timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(AGY_BINARY, ["models"], { timeout: timeoutMs, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`agy models failed: ${stderr?.trim() || error.message}`));
				return;
			}
			resolve(stdout);
		});
	});
}

export async function fetchAgyModels(timeoutMs = 15_000): Promise<ProviderModelConfig[]> {
	const stdout = await runAgyModels(timeoutMs);
	const parsed = parseAgyModelsOutput(stdout);
	if (parsed.length === 0) throw new Error("agy models returned no models");
	return parsed.map((model) => toModelConfig(model.id, model.name));
}
