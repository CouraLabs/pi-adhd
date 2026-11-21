import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
    it("renders a basic heading", () => {
        const html = renderMarkdown("# Hello");
        expect(html).toContain("<h1>Hello</h1>");
    });

    it("renders bold, italic, and lists", () => {
        const html = renderMarkdown("**bold** *italic*\n- one\n- two");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>one</li>");
        expect(html).toContain("<li>two</li>");
    });

    it("strips <script> tags (XSS protection)", () => {
        const html = renderMarkdown("<script>alert(1)</script>");
        expect(html).not.toMatch(/<script/i);
        // The result must be safe to inject into the DOM as innerHTML.
        // We can't directly check that no script executes in jsdom-free vitest,
        // but stripping the tag is the necessary condition.
        expect(html).not.toContain("alert(1)");
    });

    it("strips dangerous attributes but keeps safe HTML", () => {
        const html = renderMarkdown('<b onclick="alert(1)">click</b>');
        expect(html).toContain("<b>click</b>");
        expect(html).not.toMatch(/onclick/i);
    });

    it("returns an empty string for empty input", () => {
        expect(renderMarkdown("")).toBe("");
    });

    it("renders YAML frontmatter as a code block (per spec §2.6)", () => {
        const md = [
            "---",
            "id: abc-123",
            "title: Test Task",
            "created: 2025-06-10",
            "priority: high",
            "tags:",
            "  - foo",
            "  - bar",
            "---",
            "",
            "# Test Task",
            "",
            "Body content.",
        ].join("\n");

        const html = renderMarkdown(md);
        // Frontmatter is rendered as a <pre><code> block by marked.
        expect(html).toContain("<pre>");
        expect(html).toMatch(/<code[\s>]/);
        expect(html).toContain("abc-123");
        // The H1 from the body is still rendered.
        expect(html).toContain("<h1>Test Task</h1>");
    });
});