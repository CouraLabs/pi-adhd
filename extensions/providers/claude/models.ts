export const STANDARD_CONTEXT_WINDOW = 200_000;
export const LONG_CONTEXT_WINDOW = 1_000_000;
export const LONG_CONTEXT_SUFFIX = "[1m]";

const MAX_OUTPUT_TOKENS = 64_000;

const CLAUDE_FAMILIES = [
	{ id: "claude-opus-5-5", name: "Claude Opus 5.5" },
	{ id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
	{ id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
] as const;

export const CLAUDE_MODELS = CLAUDE_FAMILIES.flatMap((family) => [
	{ id: family.id, name: family.name, contextWindow: STANDARD_CONTEXT_WINDOW, maxTokens: MAX_OUTPUT_TOKENS },
	{
		id: `${family.id}${LONG_CONTEXT_SUFFIX}`,
		name: `${family.name} (1M)`,
		contextWindow: LONG_CONTEXT_WINDOW,
		maxTokens: MAX_OUTPUT_TOKENS,
	},
]);

const FAMILY_MODEL_IDS = {
	sonnet: "claude-sonnet-5-5",
	opus: "claude-opus-5-5",
	haiku: "claude-haiku-5-5",
} as const;

export function familyToSdkModelId(piModel: string | undefined): string {
	const normalizedModel = piModel?.toLowerCase() ?? "";
	const family = (Object.keys(FAMILY_MODEL_IDS) as (keyof typeof FAMILY_MODEL_IDS)[]).find((name) => normalizedModel.includes(name));
	return family === undefined ? "inherit" : FAMILY_MODEL_IDS[family];
}
