import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RESPONSE_STYLE_SECTION = "response_style";

export const RESPONSE_STYLE_RULES = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "prompts", "response-style.md"),
	"utf8",
).trim();

export function taggedResponseStyle(): string {
	return `<${RESPONSE_STYLE_SECTION}>\n${RESPONSE_STYLE_RULES}\n</${RESPONSE_STYLE_SECTION}>`;
}
