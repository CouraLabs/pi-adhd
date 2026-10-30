// src/components/ToolCall.tsx
// Reserved for future use — the v1 dataset doesn't persist toolCalls on the
// assistant message, so we render toolResults as standalone cards. This file
// exists to keep the component naming symmetric for the next iteration.

export interface ToolCallProps {
  name: string;
  args?: unknown;
}

export function ToolCall({ name }: ToolCallProps): JSX.Element {
  return (
    <div className="tool-call">
      <span className="tool-call-name">{name}</span>
    </div>
  );
}
