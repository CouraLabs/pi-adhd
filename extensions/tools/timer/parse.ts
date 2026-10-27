const UNIT_MS = { h: 3_600_000, m: 60_000, s: 1_000 } as const;
type Unit = keyof typeof UNIT_MS;

const DURATION_RE = /(\d+(?:\.\d+)?)\s*([hms])/g;

export function parseDuration(input: string): number | undefined {
	const text = input.trim().toLowerCase();
	if (!text) return undefined;

	let total = 0;
	const seen = new Set<Unit>();
	DURATION_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = DURATION_RE.exec(text)) !== null) {
		const unit = match[2] as Unit;
		if (seen.has(unit)) return undefined;
		seen.add(unit);
		total += Number(match[1]) * UNIT_MS[unit];
	}

	if (total <= 0) return undefined;

	const leftover = text.replace(DURATION_RE, "").replace(/\s+/g, "");
	return leftover.length === 0 ? total : undefined;
}
