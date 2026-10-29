// @vitest-environment happy-dom
// tests/client/Markdown-xss.test.tsx
//
// Regression tests for the XSS-by-escape property of <Markdown>. Do NOT add
// `rehype-raw` — that would re-introduce XSS. These tests would fail loudly
// the day that happens.

import { describe, expect, it } from "vitest";
import { renderWithRouter } from "./helpers/renderWithRouter";
import { Markdown } from "../../src/components/Markdown";

describe("Markdown XSS safety", () => {
  it("never produces a <script> element from inline HTML in the source", () => {
    const { container } = renderWithRouter(
      <Markdown source={"<script>alert(1)</script>"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    // The dangerous string ends up as escaped text, not as a real element.
    expect(container.textContent).toContain("alert(1)");
  });

  it("never produces an <img> tag with attacker-controlled handlers", () => {
    const { container } = renderWithRouter(
      <Markdown source={'<img src="x" onerror="alert(1)" />'} />,
    );
    // No real <img> element appears in the DOM, either via markdown image
    // syntax OR via passthrough raw HTML.
    expect(container.querySelector("img")).toBeNull();
    // The dangerous source text ends up escaped, not interpreted.
    expect(container.textContent).toContain("onerror");
  });

  it("never produces an <iframe> from raw HTML in the source", () => {
    const { container } = renderWithRouter(
      <Markdown
        source={'<iframe src="https://evil.example.com"></iframe>'}
      />,
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders a javascript: href as text, not as an active anchor attribute", () => {
    // react-markdown's defaultUrlTransform sanitizes javascript: URLs by
    // stripping them, so the anchor either has no href or a non-javascript
    // value. Either is acceptable; the contract is "does not execute".
    const { container } = renderWithRouter(
      <Markdown source={'[click](javascript:alert(1))'} />,
    );
    // No script tag produced.
    expect(container.querySelector("script")).toBeNull();
    // If an anchor is rendered, its href must not be a javascript: URI.
    const a = container.querySelector("a");
    if (a) {
      const href = a.getAttribute("href") ?? "";
      expect(href.toLowerCase().startsWith("javascript:")).toBe(false);
    }
  });

  it("does not allow onclick-style attribute injection via markdown links", () => {
    // An attacker-controlled "title" with quotes in the URL must not produce
    // an extra onclick attribute on the rendered <a>.
    const { container } = renderWithRouter(
      <Markdown
        source={'[text](https://example.com" onclick="alert(1))'}
      />,
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    // No onclick attribute on the anchor.
    expect(a?.hasAttribute("onclick")).toBe(false);
    // The text content is preserved verbatim.
    expect(container.textContent).toContain("text");
  });
});
