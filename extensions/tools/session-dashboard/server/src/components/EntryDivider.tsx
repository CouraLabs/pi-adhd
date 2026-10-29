// src/components/EntryDivider.tsx
import type { ReactNode } from "react";

export interface EntryDividerProps {
  children: ReactNode;
}

export function EntryDivider({ children }: EntryDividerProps): JSX.Element {
  return (
    <div className="entry-divider" role="separator" aria-label="entry divider">
      <span className="entry-divider-line" />
      <span className="entry-divider-text">{children}</span>
      <span className="entry-divider-line" />
    </div>
  );
}
