/**
 * Write `model: <id>` into an agent markdown file without disturbing anything
 * else. The frontmatter reader is `parseFrontmatter` in the pi SDK: the block is
 * delimited by `---` on the first line and the first following `\n---`, and the
 * YAML between them is parsed with the `yaml` package. So this writer does a
 * line-targeted edit rather than a YAML round-trip — re-serializing would drop
 * comments and reorder keys.
 */

/** Quote a YAML scalar only when a plain scalar would be ambiguous. */
function yamlScalar(value: string): string {
	if (/^[A-Za-z0-9._/@:-]+$/.test(value) && !value.includes(": ")) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Add or replace the top-level `model:` key, preserving the rest byte-for-byte. */
export function writeAgentModel(content: string, modelId: string): string {
	const line = `model: ${yamlScalar(modelId)}`;

	// Normalize for the edit, then restore the input's line endings and BOM.
	const crlf = content.includes("\r\n");
	const hadBom = content.startsWith("\uFEFF");
	const normalized = (hadBom ? content.slice(1) : content).replace(/\r\n/g, "\n");

	let result: string;
	const endIndex = normalized.indexOf("\n---", 3);
	if (normalized.startsWith("---") && endIndex !== -1) {
		// The YAML block spans the opening delimiter's newline (index 3) to the
		// `\n---` that closes it — exactly what the SDK parser slices.
		const block = normalized.slice(4, endIndex);
		let nextBlock: string;
		if (/^model\s*:/m.test(block)) {
			nextBlock = block.replace(/^model\s*:.*$/m, line);
		} else {
			const sep = block.trim().length === 0 ? "" : "\n";
			nextBlock = block + sep + line;
		}
		// Everything after the closing delimiter is copied verbatim, including
		// the body and its trailing newline.
		result = "---\n" + nextBlock + "\n---" + normalized.slice(endIndex + 4);
	} else {
		result = "---\n" + line + "\n---\n\n" + normalized;
	}

	const restored = crlf ? result.replace(/\n/g, "\r\n") : result;
	return hadBom ? "\uFEFF" + restored : restored;
}
