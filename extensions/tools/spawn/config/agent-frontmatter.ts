function yamlScalar(value: string): string {
	if (/^[A-Za-z0-9._/@:-]+$/.test(value) && !value.includes(": ")) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function writeFrontmatterValue(content: string, key: string, value: string): string {
	const line = `${key}: ${yamlScalar(value)}`;

	const crlf = content.includes("\r\n");
	const hadBom = content.startsWith("\uFEFF");
	const normalized = (hadBom ? content.slice(1) : content).replace(/\r\n/g, "\n");

	let result: string;
	const endIndex = normalized.indexOf("\n---", 3);
	if (normalized.startsWith("---") && endIndex !== -1) {

		const block = normalized.slice(4, endIndex);
		let nextBlock: string;
		const keyLine = new RegExp(`^${key}\\s*:.*$`, "m");
		if (keyLine.test(block)) {
			nextBlock = block.replace(keyLine, line);
		} else {
			const sep = block.trim().length === 0 ? "" : "\n";
			nextBlock = block + sep + line;
		}

		result = "---\n" + nextBlock + "\n---" + normalized.slice(endIndex + 4);
	} else {
		result = "---\n" + line + "\n---\n\n" + normalized;
	}

	const restored = crlf ? result.replace(/\n/g, "\r\n") : result;
	return hadBom ? "\uFEFF" + restored : restored;
}

export function removeFrontmatterValue(content: string, key: string): string {

	const crlf = content.includes("\r\n");
	const hadBom = content.startsWith("\uFEFF");
	const normalized = (hadBom ? content.slice(1) : content).replace(/\r\n/g, "\n");

	const endIndex = normalized.indexOf("\n---", 3);
	let result: string;
	if (normalized.startsWith("---") && endIndex !== -1) {
		const block = normalized.slice(4, endIndex);

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
