// src/components/CustomMessage.tsx
export interface CustomMessageProps {
  customType: string;
  content: string;
  display: boolean;
}

export function CustomMessage({ customType, content }: CustomMessageProps): JSX.Element {
  return (
    <div className="custom-message">
      <div className="custom-message-type">{customType}</div>
      <pre className="custom-message-content">{content}</pre>
    </div>
  );
}
