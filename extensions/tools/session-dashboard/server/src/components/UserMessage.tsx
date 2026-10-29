// src/components/UserMessage.tsx
import type { ContentBlock } from "../types";
import { Markdown } from "./Markdown";

export interface UserMessageProps {
  content: ContentBlock[];
  timestamp?: string | number;
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

export function UserMessage({ content }: UserMessageProps): JSX.Element {
  const text = blocksToText(content);
  return (
    <div className="message message-user">
      <div className="message-role">user</div>
      <Markdown source={text} />
    </div>
  );
}
