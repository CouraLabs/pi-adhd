/**
 * timer/parse — duration parsing for `/timer`.
 *
 * Accepted forms are the unit sequences `XXXh`, `XXXm`, `XXXs`, `XXXmXXXs`,
 * `XXXhXXXm`, and `XXXhXXXmXXXs` (units may be separated by spaces). A unit may
 * not repeat, and the whole string must be consumed, so `1h30` is rejected
 * rather than silently read as an hour. Fractions are allowed (`1.5h`).
 */

const UNIT_MS = { h: 3_600_000, m: 60_000, s: 1_000 } as const;
type Unit = keyof typeof UNIT_MS;

const DURATION_RE = /(\d+(?:\.\d+)?)\s*([hms])/g;

/** Parse a duration into milliseconds, or `undefined` when the pattern is invalid. */
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
	// Reject trailing garbage: remove every matched run and require nothing left.
	const leftover = text.replace(DURATION_RE, "").replace(/\s+/g, "");
	return leftover.length === 0 ? total : undefined;
}
