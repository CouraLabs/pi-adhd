import type { EnvInfo } from "./env.ts";
import type { ProjectContextLoader } from "./project-context.ts";
import type { AgentPromptConfig, PromptInheritance } from "../types.ts";

export interface InheritedPrompt {

  systemPrompt: string;

  cwd: string;

  strategy?: PromptInheritance;

  portablePrompt?: string;
}

export function buildAgentPrompt(
  config: AgentPromptConfig,
  cwd: string,
  env: EnvInfo,
  inherited?: InheritedPrompt,
  loadProjectContext?: ProjectContextLoader,
): string {
  const header = buildPromptHeader(config.name, cwd, env);

  const identity = inherited ? adoptedIdentity(inherited, cwd) : genericBase;
  const projectContext = ownProjectContext(inherited, cwd, loadProjectContext);

  if (config.promptMode === "append") {
    const customSection = config.systemPrompt.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    return identity + projectContext + "\n\n" + header + customSection;
  }

  return identity + projectContext + "\n\n" + header + "\n\n" + config.systemPrompt;
}

function ownProjectContext(
  inherited: InheritedPrompt | undefined,
  cwd: string,
  loadProjectContext: ProjectContextLoader | undefined,
): string {
  if (!inherited || !loadProjectContext) return "";
  const adoptedDescribesOwnDirectory =
    inherited.strategy !== "portable" && cwd === inherited.cwd;
  if (adoptedDescribesOwnDirectory) return "";
  const block = loadProjectContext(cwd);
  return block ? `\n\n${block}` : "";
}

function adoptedIdentity(inherited: InheritedPrompt, cwd: string): string {
  if (inherited.strategy !== "portable") {
    return inheritedIdentity(
      inherited.systemPrompt,
      inherited.cwd,
      cwd !== inherited.cwd,
    );
  }

  return inherited.portablePrompt?.trim() || genericBase;
}

function buildPromptHeader(agentName: string, cwd: string, env: EnvInfo): string {
  const activeAgentTag = `<active_agent name="${agentName}"/>\n\n`;

  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  return `${activeAgentTag}${envBlock}`;
}

const SKILLS_SECTION_HEADING =
  "The following skills provide specialized instructions for specific tasks.";

const SKILLS_CATALOGUE_CLOSE = "</available_skills>";

const SKILLS_SECTION_OPEN = "<skills>";

const SKILLS_SECTION_CLOSE = "</skills>";

const CWD_SECTION_OPEN = "<cwd>";

const CWD_SECTION_CLOSE = "</cwd>";

const TOOLS_SECTION_OPEN = "<tools>";

const TOOLS_SECTION_CLOSE = "</tools>";

const RULES_SECTION_OPEN = "<rules>";

const RULES_SECTION_CLOSE = "</rules>";

const SECTIONS_BELOW_RULES: ReadonlySet<string> = new Set([
  "<docs>",
  "<addendum>",
  "<project_context>",
  "<skills>",
  "<cwd>",
]);

const PROJECT_CONTEXT_OPEN = "<project_context>";

const PROJECT_CONTEXT_CLOSE = "</project_context>";

const PROJECT_CONTEXT_LEAD_IN = "Project-specific instructions and guidelines:";

function inheritedIdentity(
  prompt: string,
  parentCwd: string,
  cutProjectContext: boolean,
): string {
  const lines = prompt.split("\n");
  const tail = sessionResolvedTailStart(lines, parentCwd, cutProjectContext);
  if (tail.at === -1) return prompt;
  const head = lines.slice(0, tail.at);
  const kept = tail.shape === "section" ? withoutToolSurface(head) : head;
  return kept.join("\n").trimEnd();
}

function withoutToolSurface(head: readonly string[]): readonly string[] {
  const bound = laterSectionStart(head);
  const toolsAt = head.indexOf(TOOLS_SECTION_OPEN);
  if (toolsAt === -1 || toolsAt >= bound) return head;
  const toolsCloseAt = head.indexOf(TOOLS_SECTION_CLOSE, toolsAt);
  if (toolsCloseAt === -1 || toolsCloseAt >= bound) return head;
  const rulesAt = toolsCloseAt + 2;
  if (head[toolsCloseAt + 1] !== "" || head[rulesAt] !== RULES_SECTION_OPEN) {
    return head;
  }
  const rulesCloseAt = head.indexOf(RULES_SECTION_CLOSE, rulesAt);
  if (rulesCloseAt === -1 || rulesCloseAt >= bound) return head;
  const spanEnd = head[rulesCloseAt + 1] === "" ? rulesCloseAt + 2 : rulesCloseAt + 1;
  return [...head.slice(0, toolsAt), ...head.slice(spanEnd)];
}

function laterSectionStart(head: readonly string[]): number {
  const at = head.findIndex((line) => SECTIONS_BELOW_RULES.has(line));
  return at === -1 ? head.length : at;
}

type PromptShape = "footer" | "section" | "unanchored";

interface AnchoredTail {

  readonly at: number;
  readonly shape: PromptShape;
}

function sessionResolvedTailStart(
  lines: readonly string[],
  parentCwd: string,
  cutProjectContext: boolean,
): AnchoredTail {
  const tail = cwdAnchoredTailStart(lines, parentCwd);
  if (!cutProjectContext || tail.at === -1) return tail;
  const projectContextAt = projectContextStart(lines, tail.at);
  return projectContextAt === -1 ? tail : { ...tail, at: projectContextAt };
}

function cwdAnchoredTailStart(
  lines: readonly string[],
  parentCwd: string,
): AnchoredTail {
  const footerAt = lines.lastIndexOf(
    `Current working directory: ${toPromptPath(parentCwd)}`,
  );
  if (footerAt !== -1) {
    const catalogueAt = skillsSectionStart(lines, footerAt);
    return { at: catalogueAt === -1 ? footerAt : catalogueAt, shape: "footer" };
  }
  const cwdAt = cwdSectionStart(lines, parentCwd);
  if (cwdAt !== -1) {
    return { at: skillsSectionWrapperStart(lines, cwdAt), shape: "section" };
  }

  return { at: skillsSectionStart(lines, -1), shape: "unanchored" };
}

function cwdSectionStart(lines: readonly string[], parentCwd: string): number {
  for (
    let openAt = lines.lastIndexOf(CWD_SECTION_OPEN);
    openAt !== -1;
    openAt = lines.lastIndexOf(CWD_SECTION_OPEN, openAt - 1)
  ) {
    if (
      lines[openAt + 1] === toPromptPath(parentCwd) &&
      lines[openAt + 2] === CWD_SECTION_CLOSE
    ) {
      return openAt;
    }
  }
  return -1;
}

function skillsSectionWrapperStart(
  lines: readonly string[],
  cwdAt: number,
): number {
  let closeAt = cwdAt - 1;
  while (closeAt >= 0 && lines[closeAt] === "") closeAt--;
  if (closeAt < 0 || lines[closeAt] !== SKILLS_SECTION_CLOSE) return cwdAt;
  const openAt = lines.lastIndexOf(SKILLS_SECTION_OPEN, closeAt);
  if (openAt === -1 || lines[openAt + 1] !== SKILLS_SECTION_HEADING) return cwdAt;
  return openAt;
}

function projectContextStart(lines: readonly string[], tailAt: number): number {
  let closeAt = tailAt - 1;
  while (closeAt >= 0 && lines[closeAt] === "") closeAt--;
  if (closeAt < 0 || lines[closeAt] !== PROJECT_CONTEXT_CLOSE) return -1;
  for (
    let openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, closeAt);
    openAt !== -1;
    openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, openAt - 1)
  ) {
    if (
      lines[openAt + 2] === PROJECT_CONTEXT_LEAD_IN ||
      lines[openAt + 1] === PROJECT_CONTEXT_LEAD_IN
    ) {
      return openAt;
    }
  }
  return -1;
}

function skillsSectionStart(
  lines: readonly string[],
  footerAt: number,
): number {
  const catalogueEnd = catalogueCloseBefore(lines, footerAt);
  return catalogueEnd === -1
    ? -1
    : lines.lastIndexOf(SKILLS_SECTION_HEADING, catalogueEnd);
}

function catalogueCloseBefore(
  lines: readonly string[],
  footerAt: number,
): number {
  if (footerAt === -1) {
    return lines.lastIndexOf(SKILLS_CATALOGUE_CLOSE);
  }
  return lines[footerAt - 1] === SKILLS_CATALOGUE_CLOSE ? footerAt - 1 : -1;
}

function toPromptPath(cwd: string): string {
  return cwd.replaceAll("\\", "/");
}

const genericBase = `# Instructions
Do what has been asked; nothing more, nothing less.`;
