// src/components/CodeBlock.tsx
//
// `<pre>` override used by `<Markdown>`. Adds:
//   - A header bar with the detected language + optional filename and a
//     copy-to-clipboard button.
//   - A floating copy button when there is no header bar.
//
// The language + filename come from the `<code>` child's `className`
// (`"hljs language-X"` or `"hljs language-X:filename"`). This is the shape
// produced by `rehype-highlight` after react-markdown wires it into the
// markdown AST. The info string from the original ``` fence is preserved
// verbatim inside the className.

import {
  isValidElement,
  useState,
  type JSX,
  type ReactElement,
  type ReactNode,
} from "react";

export interface CodeBlockProps {
  children?: ReactNode;
}

interface CodeLikeProps {
  className?: string;
  children?: ReactNode;
}

function pickCodeChild(children: ReactNode): ReactElement<CodeLikeProps> | null {
  // react-markdown v9 hands us a single <code> React element as children.
  if (!isValidElement<CodeLikeProps>(children)) return null;
  return children as ReactElement<CodeLikeProps>;
}

interface ParsedMeta {
  lang: string | null;
  filename: string | null;
}

function parseMeta(className: string | undefined): ParsedMeta {
  if (!className) return { lang: null, filename: null };
  // Find a "language-X" token. Multiple classes are space-separated.
  // Example: "hljs language-python:script.py"
  const tokens = className.split(/\s+/);
  const langToken = tokens.find((t) => t.startsWith("language-"));
  if (!langToken) return { lang: null, filename: null };
  // Strip prefix, then split on ":" for `lang:filename`.
  const value = langToken.slice("language-".length);
  if (!value) return { lang: null, filename: null };
  const colonIdx = value.indexOf(":");
  if (colonIdx >= 0) {
    const lang = value.slice(0, colonIdx).trim();
    const filename = value.slice(colonIdx + 1).trim();
    return {
      lang: lang ? lang : null,
      filename: filename ? filename : null,
    };
  }
  // No colon — if it looks like a filename (contains "." or "/"), treat as
  // filename only. Otherwise treat as language.
  if (/[./]/.test(value)) return { lang: null, filename: value };
  return { lang: value, filename: null };
}

/**
 * Walk a React node tree and return its text content concatenated. Used to
 * produce the string that gets written to the clipboard via the copy button.
 */
export function flattenText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenText(node.props.children);
  }
  return "";
}

function CodeBlockImpl({ children }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const codeChild = pickCodeChild(children);
  const className = codeChild?.props?.className ?? "";
  const { lang, filename } = parseMeta(className);
  const sourceText = codeChild ? flattenText(codeChild.props.children) : flattenText(children);

  // Only render a header bar when we have a filename. The plan: "No filename
  // → no header bar" — the copy button is always discoverable as a floating
  // button overlay. We deliberately DO NOT show a header for language-only
  // blocks; a copy button alone is less intrusive.
  const showHeader = !!filename;
  const headerLabel = filename ?? "code";

  const onCopy = (): void => {
    const text = sourceText;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        },
        () => {
          // Silent fail — the user can still select + copy manually.
        },
      );
    }
  };

  return (
    <div className="code-block">
      {showHeader ? (
        <div className="code-block-header">
          <span
            className="code-block-filename"
            title={headerLabel}
          >
            {headerLabel}
          </span>
          <button
            type="button"
            className="code-block-copy"
            onClick={onCopy}
            aria-label={copied ? "copied" : "copy code"}
            title={copied ? "Copied!" : "Copy to clipboard"}
          >
            {copied ? "✓" : "⧉"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="code-block-copy code-block-copy-floating"
          onClick={onCopy}
          aria-label={copied ? "copied" : "copy code"}
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? "✓" : "⧉"}
        </button>
      )}
      <pre className="code-block-pre">{codeChild ?? children}</pre>
    </div>
  );
}

// Named export so other tests/utility code can use it without re-implementing
// the parsing logic. Not memoized — the parsing is cheap and parent renders
// are infrequent.
export { parseMeta, pickCodeChild };
export type { ParsedMeta };

// `CodeBlock` is a leaf used inside `<Markdown>`. Markdown memoization at the
// parent level is what prevents re-renders here in practice.
export const CodeBlock = CodeBlockImpl;
