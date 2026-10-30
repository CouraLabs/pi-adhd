// src/components/BranchSummary.tsx
export interface BranchSummaryProps {
  summary: string;
}

export function BranchSummary({ summary }: BranchSummaryProps): JSX.Element {
  return (
    <div className="branch-summary">
      <div className="branch-summary-header">
        <span className="branch-summary-label">Branch Summary</span>
      </div>
      <pre className="branch-summary-text">{summary}</pre>
    </div>
  );
}
