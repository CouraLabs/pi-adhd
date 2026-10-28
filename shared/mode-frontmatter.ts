import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface ModeFrontmatter {
	model?: string;
}

export type ModeFileParse =
	| { frontmatter: ModeFrontmatter; body: string }
	| { error: string };

export function parseModeFile(content: string): ModeFileParse {
	if (!content.startsWith("---")) {
		return { frontmatter: {}, body: content };
	}
	if (!content.includes("\n---", 3)) {
		return { error: "frontmatter has no closing --- delimiter" };
	}
	let parsed: { frontmatter: unknown; body: string };
	try {
		parsed = parseFrontmatter(content);
	} catch (error) {
		return { error: `invalid frontmatter: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (!isPlainObject(parsed.frontmatter)) {
		return { error: "frontmatter must be a YAML mapping, not a scalar or list" };
	}
	const model = parsed.frontmatter["model"];
	if (model !== undefined && typeof model !== "string") {
		return { error: `frontmatter "model" must be a string, got ${typeof model}` };
	}
	return { frontmatter: model === undefined ? {} : { model }, body: parsed.body };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
