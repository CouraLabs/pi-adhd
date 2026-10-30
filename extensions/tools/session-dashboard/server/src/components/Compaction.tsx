// src/components/Compaction.tsx
export interface CompactionProps {
  summary: string;
  tokens: number;
  details?: { readFiles?: string[]; modifiedFiles?: string[] };
}

export function Compaction({ summary, tokens, details }: CompactionProps): JSX.Element {
  const readFiles = details?.readFiles ?? [];
  const modifiedFiles = details?.modifiedFiles ?? [];
  return (
    <div className="compaction">
      <div className="compaction-header">
        <span className="compaction-label">Compaction</span>
        <span className="compaction-tokens">was {tokens.toLocaleString()} tokens</span>
      </div>
      <pre className="compaction-summary">{summary}</pre>
      {(readFiles.length > 0 || modifiedFiles.length > 0) ? (
        <div className="compaction-files">
          {readFiles.length > 0 ? (
            <div className="compaction-files-group">
              <span className="compaction-files-label">read</span>
              <ul className="compaction-files-list">
                {readFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {modifiedFiles.length > 0 ? (
            <div className="compaction-files-group">
              <span className="compaction-files-label">modified</span>
              <ul className="compaction-files-list">
                {modifiedFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
