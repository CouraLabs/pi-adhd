/**
 * agent-frontmatter.ts — write a top-level frontmatter key (`model: <id>`,
 * `thinking: <level>`, …) into an agent markdown file without disturbing
 * anything else.
 *
 * The frontmatter reader is `parseFrontmatter` in the pi SDK: the block is
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

/** Add or replace a top-level `key:` entry, preserving the rest byte-for-byte. */
export function writeFrontmatterValue(content: string, key: string, value: string): string {
	const line = `${key}: ${yamlScalar(value)}`;

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
		const keyLine = new RegExp(`^${key}\\s*:.*$`, "m");
		if (keyLine.test(block)) {
			nextBlock = block.replace(keyLine, line);
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

/** Remove a top-level `key:` entry, preserving the rest byte-for-byte. */
export function removeFrontmatterValue(content: string, key: string): string {
	// Normalize for the edit, then restore the input's line endings and BOM.
	const crlf = content.includes("\r\n");
	const hadBom = content.startsWith("\uFEFF");
	const normalized = (hadBom ? content.slice(1) : content).replace(/\r\n/g, "\n");

	const endIndex = normalized.indexOf("\n---", 3);
	let result: string;
	if (normalized.startsWith("---") && endIndex !== -1) {
		const block = normalized.slice(4, endIndex);
		// `\n?` eats the match's own newline; a trailing newline left when the key
		// was the block's last line is stripped too, so no blank line remains.
		const keyLine = new RegExp(`^${key}\\s*:.*\\n?`, "m");
		const cleaned = block.replace(keyLine, "").replace(/\n$/, "");
		result = keyLine.test(block)
			? "---\n" + cleaned + "\n---" + normalized.slice(endIndex + 4)
			: normalized;
	} else {
		result = normalized;
	}

	const restored = crlf ? result.replace(/\n/g, "\r\n") : result;
	return hadBom ? "\uFEFF" + restored : restored;
}
