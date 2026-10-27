import { debugNote } from "../debug.ts";

export interface ContextFile {

  path: string;

  content: string;
}

export function renderProjectContext(
  contextFiles: readonly ContextFile[] | undefined,
): string | undefined {
  if (!contextFiles || contextFiles.length === 0) return undefined;
  const body = [
    "Project-specific instructions and guidelines:",
    ...contextFiles.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
  return `<project_context>\n${body}\n</project_context>`;
}

export type ProjectContextLoader = (cwd: string) => string | undefined;

export type ContextFileDiscovery = (options: {
  cwd: string;
  agentDir: string;
}) => ContextFile[];

export function createProjectContextLoader(
  discover: ContextFileDiscovery,
  agentDir: string,
): ProjectContextLoader {
  return (cwd) => {
    const block = renderProjectContext(discover({ cwd, agentDir }));
    if (!block) debugNote(`no project context under ${cwd}`);
    return block;
  };
}
