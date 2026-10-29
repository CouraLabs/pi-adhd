// src/components/BashExecution.tsx
export interface BashExecutionProps {
  command: string;
  output: string;
  exitCode: number;
  cancelled?: boolean;
  truncated?: boolean;
}

export function BashExecution({
  command,
  output,
  exitCode,
  cancelled,
  truncated,
}: BashExecutionProps): JSX.Element {
  const exitClass = cancelled
    ? "bash-exit bash-exit-cancelled"
    : exitCode === 0
      ? "bash-exit bash-exit-ok"
      : "bash-exit bash-exit-error";
  const exitLabel = cancelled
    ? "cancelled"
    : `exit ${exitCode}`;
  return (
    <div className="bash">
      <div className="bash-header">
        <span className="bash-label">bash</span>
        <span className={exitClass}>{exitLabel}</span>
      </div>
      <pre className="bash-command">$ {command}</pre>
      <pre className="bash-output">
        {output}
        {truncated ? "\n…[truncated]" : null}
      </pre>
    </div>
  );
}
