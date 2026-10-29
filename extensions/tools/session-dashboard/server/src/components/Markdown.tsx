// src/components/Markdown.tsx
//
// Renders a markdown string as a chat-style prose block with GFM extensions
// (tables, task lists, strikethrough) and code-block syntax highlighting.
//
// XSS SAFETY — DO NOT add `rehype-raw`.
//
// `react-markdown` escapes HTML by default. Any HTML in the input source is
// rendered as literal text, NOT interpreted. This is the sole XSS defense for
// arbitrary user / model text. If raw HTML is ever needed, the path is to
// switch to `rehype-sanitize` with an explicit allowlist — do NOT add
// `rehype-raw`, which would re-introduce XSS.
//
// IMAGES — DO NOT render `<img>`.
//
// `![alt](url)` syntax is rendered as an italic `[image: alt]` placeholder.
// Image previews remain a deferred item; local file references (`./foo.png`)
// in Pi sessions have no base URL to resolve against, so the honest default
// is to not fetch them.
//
// PERFORMANCE.
//
// `Markdown` is wrapped in `React.memo` so re-renders triggered by a parent
// re-rendering (toolResult grouping, scroll hooks) skip the parse as long as
// the `source` string is reference-equal. `blocksToText` in
// `AssistantMessage` / `UserMessage` produces a stable string for a stable
// input array, so memo holds in practice. Layout shifts from late code-block
// syntax highlighting are acceptable in v1; flag in code if you see them.

import type { JSX, ReactNode } from "react";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";

export interface MarkdownProps {
  source: string;
}

function MarkdownImpl({ source }: MarkdownProps): JSX.Element {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Replace the default <pre> with our themed wrapper. Adds a
          // copy-to-clipboard button + optional filename header
          // (```python:script.py).
          pre: ({ children }: { children?: ReactNode }): JSX.Element => (
            <CodeBlock>{children}</CodeBlock>
          ),
          // Links — open in a new tab with the safe rel. We do not validate
          // URLs because Pi sessions legitimately contain localhost / IP
          // URLs (e.g. http://localhost:11434 for Ollama).
          a: ({ href, children }: { href?: string; children?: ReactNode }): JSX.Element => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {children}
            </a>
          ),
          // Image policy: ignore the URL entirely; render an italic
          // placeholder span so the user can tell the model referenced an
          // image without us fetching it.
          img: ({ alt }: { alt?: string }): JSX.Element => {
            const a = typeof alt === "string" && alt.trim() ? alt : "no alt";
            return (
              <span className="markdown-image-placeholder">
                [image: {a}]
              </span>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
