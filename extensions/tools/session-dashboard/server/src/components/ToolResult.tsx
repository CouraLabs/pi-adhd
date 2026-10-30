// src/components/ToolResult.tsx
import type { ContentBlock } from "../types";

export interface ToolResultProps {
  toolCallId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
  errorMessage?: string;
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

export function ToolResult({
  toolName,
  content,
  isError,
  errorMessage,
}: ToolResultProps): JSX.Element {
  const text = blocksToText(content);
  const className = `tool-result ${isError ? "tool-result-error" : ""}`.trim();
  return (
    <div className={className}>
      <div className="tool-result-header">
        <span className="tool-result-name">{toolName}</span>
        <span className={`tool-result-status ${isError ? "is-error" : "is-ok"}`}>
          {isError ? "error" : "ok"}
        </span>
      </div>
      {isError && errorMessage ? (
        <div className="tool-result-error-message">{errorMessage}</div>
      ) : null}
      <pre className="tool-result-content">{text}</pre>
    </div>
  );
}
