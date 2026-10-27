export interface ExpandedTools {

  toolNames: string[];

  unmatchedPatterns: string[];
}

export function expandMcpToolPatterns(
  declared: readonly string[],
  available: readonly string[],
): ExpandedTools {
  const toolNames = new Set<string>();
  const unmatchedPatterns: string[] = [];
  for (const entry of declared) {
    if (!isMcpPattern(entry)) {
      toolNames.add(entry);
      continue;
    }
    const matcher = patternMatcher(entry);
    const matches = available.filter((name) => matcher.test(name));
    if (matches.length === 0) unmatchedPatterns.push(entry);
    for (const name of matches) toolNames.add(name);
  }
  return { toolNames: [...toolNames], unmatchedPatterns };
}

function isMcpPattern(entry: string): boolean {
  return entry.startsWith("mcp__") && entry.includes("*");
}

function patternMatcher(pattern: string): RegExp {
  const source = pattern
    .split("*")
    .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`);
}
