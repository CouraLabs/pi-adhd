// src/components/AssistantMessage.tsx
import type { ContentBlock } from "../types";
import { Markdown } from "./Markdown";

export interface AssistantMessageProps {
  content: ContentBlock[];
  id?: string;
  timestamp?: string | number;
  /**
   * When true, render type:"thinking" content blocks as collapsible details
   * (with a pre tag for the thinking text). When false or undefined,
   * thinking blocks are silently dropped (preserves today's default
   * behavior). The default is intentionally opt-in.
   */
  showThinking?: boolean;
}

function blocksToText(blocks: ContentBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string") out += t;
    }
  }
  return out;
}

interface ThinkingBlockProps {
  thinking: string;
}

function ThinkingBlock({ thinking }: ThinkingBlockProps): JSX.Element {
  return (
    <details className="thinking-block">
      <summary>thinking</summary>
      <pre>{thinking}</pre>
    </details>
  );
}

export function AssistantMessage({
  content,
  showThinking,
}: AssistantMessageProps): JSX.Element {
  const text = blocksToText(content);
  return (
    <div className="message message-assistant">
      <div className="message-role">assistant</div>
      <Markdown source={text} />
      {showThinking
        ? content.map((b, i) => {
            // Defensive pattern (mirrors blocksToText above): only render
            // blocks whose type tag is the literal string "thinking" and
            // whose `thinking` payload is a string. Skips malformed or
            // schema-drifted entries without throwing.
            if (
              b &&
              typeof b === "object" &&
              (b as { type?: unknown }).type === "thinking"
            ) {
              const t = (b as { thinking?: unknown }).thinking;
              if (typeof t === "string") {
                return <ThinkingBlock key={i} thinking={t} />;
              }
            }
            return null;
          })
        : null}
    </div>
  );
}
