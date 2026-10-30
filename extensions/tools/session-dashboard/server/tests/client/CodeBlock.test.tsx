// @vitest-environment happy-dom
// tests/client/CodeBlock.test.tsx
//
// Unit tests for the <CodeBlock> component: filename/languages parsing,
// copy-button rendering and clipboard write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import {
  CodeBlock,
  parseMeta,
  flattenText,
} from "../../src/components/CodeBlock";
import { Markdown } from "../../src/components/Markdown";

describe("parseMeta", () => {
  it("parses 'python:script.py' as lang + filename", () => {
    expect(parseMeta("hljs language-python:script.py")).toEqual({
      lang: "python",
      filename: "script.py",
    });
  });

  it("parses 'language-bash' as lang only", () => {
    expect(parseMeta("hljs language-bash")).toEqual({
      lang: "bash",
      filename: null,
    });
  });

  it("parses 'language-script.py' (no colon, looks like a path) as filename only", () => {
    expect(parseMeta("language-script.py")).toEqual({
      lang: null,
      filename: "script.py",
    });
  });

  it("returns null/null for missing language class", () => {
    expect(parseMeta("hljs")).toEqual({ lang: null, filename: null });
    expect(parseMeta(undefined)).toEqual({ lang: null, filename: null });
    expect(parseMeta("")).toEqual({ lang: null, filename: null });
  });

  it("returns null/null for a strange class list with only non-language tokens", () => {
    expect(parseMeta("hljs something-else")).toEqual({
      lang: null,
      filename: null,
    });
  });
});

describe("flattenText", () => {
  it("returns the empty string for null/undefined", () => {
    expect(flattenText(null)).toBe("");
    expect(flattenText(undefined)).toBe("");
  });

  it("returns the string verbatim for a string node", () => {
    expect(flattenText("hello")).toBe("hello");
  });

  it("coerces numbers", () => {
    expect(flattenText(42)).toBe("42");
  });

  it("concatenates arrays", () => {
    expect(flattenText(["a", "b", "c"])).toBe("abc");
  });
});

describe("CodeBlock render", () => {
  beforeEach(() => {
    // happy-dom does not provide navigator.clipboard by default. Stub it.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    // React Testing Library's act() needs this flag in React 18.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders with a copy button when language is plain", () => {
    const { container } = render(
      <Markdown source={"```bash\n$ ls\n```"} />,
    );
    const copy = container.querySelector(".code-block-copy");
    expect(copy).not.toBeNull();
    expect(copy?.getAttribute("aria-label")).toBe("copy code");
  });

  it("clicking the copy button writes the code text to the clipboard", async () => {
    const writeSpy = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    const { container } = render(
      <Markdown source={"```python\nprint(1)\n```"} />,
    );
    const btn = container.querySelector(
      ".code-block-copy",
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn?.click();
      await Promise.resolve();
    });
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const arg = writeSpy.mock.calls[0][0] as string;
    expect(arg).toContain("print(1)");
  });

  it("toggles the aria-label to 'copied' immediately after click", async () => {
    const { container, rerender } = render(
      <Markdown source={"```bash\n$ ls\n```"} />,
    );
    const btn = container.querySelector(
      ".code-block-copy",
    ) as HTMLButtonElement | null;
    expect(btn?.getAttribute("aria-label")).toBe("copy code");
    // Click + flush the clipboard.writeText() promise + React re-render.
    await act(async () => {
      btn?.click();
      await Promise.resolve();
    });
    // The button DOM node is replaced by React after the state update; query
    // for it again rather than relying on the original reference.
    const btn2 = container.querySelector(
      ".code-block-copy",
    ) as HTMLButtonElement | null;
    expect(btn2?.getAttribute("aria-label")).toBe("copied");
    void rerender;
  });

  it("renders the filename header for lang:filename", () => {
    const { container } = render(
      <Markdown source={"```python:script.py\nprint(1)\n```"} />,
    );
    const fname = container.querySelector(".code-block-filename");
    expect(fname).not.toBeNull();
    expect(fname?.textContent).toBe("script.py");
  });

  it("does NOT render a filename header for plain language", () => {
    const { container } = render(
      <Markdown source={"```python\nprint(1)\n```"} />,
    );
    expect(container.querySelector(".code-block-filename")).toBeNull();
  });

  it("renders without crashing when given a non-code child (defensive)", () => {
    expect(() =>
      render(<CodeBlock>not a code child</CodeBlock>),
    ).not.toThrow();
  });
});
