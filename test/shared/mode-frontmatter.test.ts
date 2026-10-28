import { describe, expect, it } from "vitest";
import { parseModeFile } from "../../shared/mode-frontmatter.ts";

describe("parseModeFile", () => {
	it("passes through content without frontmatter byte-identically, including CRLF and BOM", () => {
		const crlf = "line one\r\nline two\r\n";
		expect(parseModeFile(crlf)).toEqual({ frontmatter: {}, body: crlf });
		const bom = "﻿prompt body\n";
		expect(parseModeFile(bom)).toEqual({ frontmatter: {}, body: bom });
	});

	it("parses a model key and returns the body without delimiters", () => {
		const result = parseModeFile("---\nmodel: sonnet\n---\n\nBody here.\n");
		expect(result).toEqual({ frontmatter: { model: "sonnet" }, body: "Body here." });
	});

	it("errors when the frontmatter is not closed", () => {
		const result = parseModeFile("---\nmodel: sonnet\n");
		expect("error" in result && result.error.length > 0).toBe(true);
	});

	it("errors on invalid YAML", () => {
		const result = parseModeFile("---\nmodel: [unclosed\n---\n");
		expect("error" in result).toBe(true);
	});

	it("errors when the body before the second delimiter makes frontmatter a scalar", () => {
		const result = parseModeFile("---\nsome text\n---\nmore");
		expect("error" in result).toBe(true);
	});

	it("errors when model is not a string", () => {
		const result = parseModeFile("---\nmodel: 4\n---\nbody");
		expect("error" in result).toBe(true);
	});

	it("ignores unknown keys and keeps the body intact", () => {
		const result = parseModeFile("---\ndescription: whatever\n---\nbody");
		expect(result).toEqual({ frontmatter: {}, body: "body" });
	});

	it("returns empty frontmatter when no model key is present", () => {
		const result = parseModeFile("---\ntitle: x\n---\nbody");
		expect(result).toEqual({ frontmatter: {}, body: "body" });
	});
});
