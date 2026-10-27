const ACRONYMS: ReadonlySet<string> = new Set(["gpt", "glm", "llm", "moe"]);
const DATE_SUFFIX = /-(?:\d{8}|latest)$/;
const VERSION_PART = /^\d{1,2}$/;
const VENDOR_PREFIX = /^claude\s+/i;
const LONG_CONTEXT_ID_SUFFIX = /\[1m\]$/i;
const LONG_CONTEXT_NAME_SUFFIX = /\s*\(1m\)$/i;

interface NamedModel {
	id: string;
	name?: string;
}

function titleCase(word: string): string {
	return ACRONYMS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);
}

function joinVersionParts(tokens: readonly string[]): string[] {
	const joined: string[] = [];
	for (const token of tokens) {
		const previous = joined[joined.length - 1];
		if (previous !== undefined && VERSION_PART.test(token) && /^\d+(?:\.\d+)*$/.test(previous) && VERSION_PART.test(previous.split(".").pop()!)) {
			joined[joined.length - 1] = `${previous}.${token}`;
		} else {
			joined.push(token);
		}
	}
	return joined;
}

export function formatModelId(modelId: string): string {
	const hasLongContext = LONG_CONTEXT_ID_SUFFIX.test(modelId);
	const bareId = (modelId.split("/").pop() ?? modelId).toLowerCase().replace(LONG_CONTEXT_ID_SUFFIX, "").replace(DATE_SUFFIX, "");
	const tokens = bareId.split(/[-_\s]+/).filter((token) => token.length > 0);
	const withoutVendor = tokens[0] === "claude" && tokens.length > 1 ? tokens.slice(1) : tokens;
	const label = joinVersionParts(withoutVendor).map(titleCase).join(" ");
	return hasLongContext ? `${label} 1M` : label;
}

function looksPretty(name: string, modelId: string): boolean {
	return name !== modelId && !/[-_/]/.test(name) && /\s/.test(name);
}

export function prettyModelName(model: NamedModel): string {
	const name = model.name?.trim();
	if (name && looksPretty(name, model.id)) {
		const withoutVendor = name.replace(VENDOR_PREFIX, "");
		return LONG_CONTEXT_NAME_SUFFIX.test(withoutVendor) ? withoutVendor.replace(LONG_CONTEXT_NAME_SUFFIX, " 1M") : withoutVendor;
	}
	return formatModelId(model.id);
}
