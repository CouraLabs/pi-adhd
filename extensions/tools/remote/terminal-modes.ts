const TRACKED_MODES = [1049, 7, 25, 1000, 1002, 1003, 1004, 1006, 2004] as const;
const PRIVATE_MODE_SEQUENCE = /\x1b\[\?([\d;]+)([hl])/g;
const CARRY_LENGTH = 32;

export class TerminalModeTracker {

	readonly #modes = new Map<number, boolean>();

	#carry = "";

	observe(text: string): void {
		const scanned = this.#carry + text;
		for (const match of scanned.matchAll(PRIVATE_MODE_SEQUENCE)) {
			const enabled = match[2] === "h";
			for (const part of match[1]!.split(";")) {
				const mode = Number(part);
				if ((TRACKED_MODES as readonly number[]).includes(mode)) this.#modes.set(mode, enabled);
			}
		}
		this.#carry = scanned.slice(-CARRY_LENGTH);
	}

	prelude(): string {
		return TRACKED_MODES.filter((mode) => this.#modes.has(mode))
			.map((mode) => `\x1b[?${mode}${this.#modes.get(mode) ? "h" : "l"}`)
			.join("");
	}
}

const TERMINAL_REPLIES = [
	/\x1b\[[?>][\d;]*c/g,
	/\x1b\[\?\d*u/g,
	/\x1b\[\?[\d;]*\$y/g,
	/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
];

export function stripTerminalReplies(input: string): string {
	return TERMINAL_REPLIES.reduce((text, pattern) => text.replace(pattern, ""), input);
}
