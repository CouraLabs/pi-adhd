import { describe, expect, it, vi } from "vitest";
import {
	formatCwd,
	formatTokens,
	padWidgetLines,
	stripStyling,
	WIDGET_LEFT_PADDING,
} from "../../shared/format.ts";

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => "/home/tester" };
});

describe("formatCwd", () => {
	describe("compact mode", () => {
		it("renders the home directory as ~", () => {
			expect(formatCwd("/home/tester")).toBe("~");
		});

		it("renders a trailing-separator home path as ~", () => {
			expect(formatCwd("/home/tester/")).toBe("~");
		});

		it("renders a home subdirectory as ./ plus the last segment", () => {
			expect(formatCwd("/home/tester/projects/foo")).toBe("./foo");
			expect(formatCwd("/home/tester/a/b/c.txt")).toBe("./c.txt");
		});

		it("renders a non-home path as ./ plus the last segment", () => {
			expect(formatCwd("/opt/tools")).toBe("./tools");
		});

		it("strips trailing separators before taking the last segment", () => {
			expect(formatCwd("/opt/tools/")).toBe("./tools");
			expect(formatCwd("/opt/tools//")).toBe("./tools");
		});

		it("handles backslash separators from Windows-style paths", () => {
			expect(formatCwd("C:\\Users\\bob\\proj")).toBe("./proj");
		});

		it("returns the root path unchanged because it trims to nothing", () => {
			expect(formatCwd("/")).toBe("/");
		});

		it("returns an empty path unchanged", () => {
			expect(formatCwd("")).toBe("");
		});

		it("returns a bare drive letter unchanged", () => {
			expect(formatCwd("C:")).toBe("C:");
		});
	});

	describe("full mode", () => {
		it("renders the home directory as ~", () => {
			expect(formatCwd("/home/tester", true)).toBe("~");
		});

		it("renders a home subdirectory as ~/ plus the remaining path", () => {
			expect(formatCwd("/home/tester/projects/foo", true)).toBe("~/projects/foo");
		});

		it("returns a non-home path unchanged", () => {
			expect(formatCwd("/opt/tools", true)).toBe("/opt/tools");
		});

		it("does not abbreviate a path that merely starts with the home text", () => {
			expect(formatCwd("/home/testerfoo", true)).toBe("/home/testerfoo");
		});
	});
});

describe("stripStyling", () => {
	it("removes SGR escape sequences", () => {
		expect(stripStyling("\x1b[31mred\x1b[0m")).toBe("red");
	});

	it("removes multi-parameter SGR sequences", () => {
		expect(stripStyling("\x1b[1;32mbold green\x1b[0m plain")).toBe("bold green plain");
	});

	it("removes OSC 8 hyperlink wrappers and keeps the link text", () => {
		expect(stripStyling("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe("link");
	});

	it("removes SGR and OSC 8 sequences from the same line", () => {
		expect(stripStyling("\x1b[36m\x1b]8;;https://example.com\x1b\\text\x1b]8;;\x1b\\\x1b[0m")).toBe("text");
	});

	it("leaves plain text untouched", () => {
		expect(stripStyling("plain")).toBe("plain");
	});
});

describe("formatTokens", () => {
	it("renders counts under 1000 as-is", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
	});

	it("renders thousands with one decimal below 10k", () => {
		expect(formatTokens(1000)).toBe("1.0k");
		expect(formatTokens(1500)).toBe("1.5k");
		expect(formatTokens(9999)).toBe("10.0k");
	});

	it("renders thousands without decimals from 10k up", () => {
		expect(formatTokens(10_000)).toBe("10k");
		expect(formatTokens(999_999)).toBe("1000k");
	});

	it("renders millions with one decimal below 10M", () => {
		expect(formatTokens(1_000_000)).toBe("1.0M");
		expect(formatTokens(1_500_000)).toBe("1.5M");
		expect(formatTokens(9_999_999)).toBe("10.0M");
	});

	it("renders millions without decimals from 10M up", () => {
		expect(formatTokens(10_000_000)).toBe("10M");
		expect(formatTokens(17_500_000)).toBe("18M");
	});
});

describe("padWidgetLines", () => {
	it("prefixes non-empty lines with the widget left padding", () => {
		expect(padWidgetLines(["a", "b c"])).toEqual([`${WIDGET_LEFT_PADDING}a`, `${WIDGET_LEFT_PADDING}b c`]);
	});

	it("leaves empty lines unpadded", () => {
		expect(padWidgetLines(["a", "", "b"])).toEqual([`${WIDGET_LEFT_PADDING}a`, "", `${WIDGET_LEFT_PADDING}b`]);
	});

	it("returns an empty array for empty input", () => {
		expect(padWidgetLines([])).toEqual([]);
	});
});
