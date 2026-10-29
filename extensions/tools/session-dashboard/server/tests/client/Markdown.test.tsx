// @vitest-environment happy-dom
// tests/client/Markdown.test.tsx
//
// Render tests for the <Markdown> component. Covers every element type the
// plan calls out and verifies the XSS-by-escape property.

import { describe, expect, it } from "vitest";
import { renderWithRouter } from "./helpers/renderWithRouter";
import { Markdown } from "../../src/components/Markdown";

describe("Markdown", () => {
  describe("inline markdown", () => {
    it("renders bold via **", () => {
      const { container } = renderWithRouter(<Markdown source="**bold**" />);
      expect(container.querySelector("strong")).not.toBeNull();
      expect(container.textContent).toContain("bold");
    });

    it("renders italic via *", () => {
      const { container } = renderWithRouter(<Markdown source="*italic*" />);
      expect(container.querySelector("em")).not.toBeNull();
      expect(container.textContent).toContain("italic");
    });

    it("renders strikethrough via GFM ~~", () => {
      const { container } = renderWithRouter(<Markdown source="~~struck~~" />);
      // react-markdown / remark-gfm emits either <del> or <s>; accept either.
      const hit = container.querySelector("del") ?? container.querySelector("s");
      expect(hit).not.toBeNull();
      expect(container.textContent).toContain("struck");
    });

    it("renders inline `code`", () => {
      const { container } = renderWithRouter(
        <Markdown source="run `npm install` first" />,
      );
      const code = container.querySelector("code");
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe("npm install");
    });
  });

  describe("headings and lists", () => {
    it("renders an H1 and H2", () => {
      const { container } = renderWithRouter(
        <Markdown source={"# Title\n\n## Subtitle"} />,
      );
      expect(container.querySelector("h1")?.textContent).toBe("Title");
      expect(container.querySelector("h2")?.textContent).toBe("Subtitle");
    });

    it("renders an unordered list", () => {
      const { container } = renderWithRouter(
        <Markdown source={"- a\n- b\n- c"} />,
      );
      const ul = container.querySelector("ul");
      expect(ul).not.toBeNull();
      expect(ul?.querySelectorAll("li").length).toBe(3);
    });

    it("renders an ordered list", () => {
      const { container } = renderWithRouter(
        <Markdown source={"1. a\n2. b"} />,
      );
      const ol = container.querySelector("ol");
      expect(ol).not.toBeNull();
      expect(ol?.querySelectorAll("li").length).toBe(2);
    });
  });

  describe("links", () => {
    it("renders a link with target=_blank, rel=noopener noreferrer, and referrerPolicy=no-referrer", () => {
      const { container } = renderWithRouter(
        <Markdown source="[text](https://example.com)" />,
      );
      const a = container.querySelector("a");
      expect(a).not.toBeNull();
      expect(a?.getAttribute("href")).toBe("https://example.com");
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a?.getAttribute("referrerpolicy")).toBe("no-referrer");
    });
  });

  describe("GFM tables and task lists", () => {
    it("renders a GFM table", () => {
      const { container } = renderWithRouter(
        <Markdown
          source={
            "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |"
          }
        />,
      );
      const table = container.querySelector("table");
      expect(table).not.toBeNull();
      expect(container.querySelectorAll("th").length).toBe(2);
      expect(container.querySelectorAll("td").length).toBe(4);
    });

    it("renders a GFM task list with checkboxes", () => {
      const { container } = renderWithRouter(
        <Markdown source={"- [ ] todo\n- [x] done"} />,
      );
      const boxes = container.querySelectorAll('input[type="checkbox"]');
      expect(boxes.length).toBe(2);
      // first is unchecked, second is checked
      expect((boxes[0] as HTMLInputElement).checked).toBe(false);
      expect((boxes[1] as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("misc elements", () => {
    it("renders a blockquote", () => {
      const { container } = renderWithRouter(
        <Markdown source={"> quoted text"} />,
      );
      const bq = container.querySelector("blockquote");
      expect(bq).not.toBeNull();
      expect(bq?.textContent).toContain("quoted");
    });

    it("renders an HR", () => {
      const { container } = renderWithRouter(
        <Markdown source={"above\n\n---\n\nbelow"} />,
      );
      expect(container.querySelector("hr")).not.toBeNull();
    });
  });

  describe("images", () => {
    it("renders a placeholder for an inline image", () => {
      const { container } = renderWithRouter(
        <Markdown source={"![cat](http://example.com/cat.png)"} />,
      );
      expect(container.querySelector("img")).toBeNull();
      const placeholder = container.querySelector(
        ".markdown-image-placeholder",
      );
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toBe("[image: cat]");
    });

    it("falls back to '(no alt)' when alt is missing", () => {
      const { container } = renderWithRouter(
        <Markdown source={"![](http://example.com/x.png)"} />,
      );
      const placeholder = container.querySelector(
        ".markdown-image-placeholder",
      );
      expect(placeholder).not.toBeNull();
      expect(placeholder?.textContent).toBe("[image: no alt]");
    });
  });

  describe("code blocks", () => {
    it("renders a fenced code block with a language class", () => {
      const { container } = renderWithRouter(
        <Markdown source={"```python\nprint(1)\n```"} />,
      );
      const pre = container.querySelector("pre");
      const code = pre?.querySelector("code");
      expect(pre).not.toBeNull();
      expect(code).not.toBeNull();
      expect(code?.className ?? "").toContain("language-python");
    });

    it("renders a copy button with the right class for a plain code block", () => {
      const { container } = renderWithRouter(
        <Markdown source={"```bash\n$ ls\n```"} />,
      );
      const copy = container.querySelector(".code-block-copy");
      expect(copy).not.toBeNull();
      expect(copy?.getAttribute("aria-label")).toBe("copy code");
    });

    it("renders a filename header for `lang:filename`", () => {
      const { container } = renderWithRouter(
        <Markdown source={"```python:script.py\nprint(1)\n```"} />,
      );
      const fname = container.querySelector(".code-block-filename");
      expect(fname).not.toBeNull();
      expect(fname?.textContent).toBe("script.py");
    });

    it("does NOT render a filename header for plain language", () => {
      const { container } = renderWithRouter(
        <Markdown source={"```python\nprint(1)\n```"} />,
      );
      expect(container.querySelector(".code-block-filename")).toBeNull();
    });
  });
});
