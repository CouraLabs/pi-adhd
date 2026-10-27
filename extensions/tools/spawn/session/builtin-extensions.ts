import {
  createCodemodeExtension,
  createMcpExtension,
  createToolSearchExtension,
  type ExtensionFactory,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";

export type BuiltinExtension = Exclude<InlineExtension, ExtensionFactory>;

export function builtinExtensionsFor(toolNames: readonly string[]): BuiltinExtension[] {
  return BUILTINS.filter((builtin) => toolNames.some(builtin.supplies)).map(({ name, factory }) => ({
    name,
    factory,
    builtin: true,
    replaceable: true,
  }));
}

const MCP_RESOURCE_TOOLS: ReadonlySet<string> = new Set([
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
]);

const BUILTINS: readonly {
  name: string;
  factory: ExtensionFactory;
  supplies: (toolName: string) => boolean;
}[] = [
  { name: "codemode", factory: createCodemodeExtension(), supplies: (tool) => tool === "codemode" },
  { name: "tool-search", factory: createToolSearchExtension(), supplies: (tool) => tool === "tool_search" },
  {
    name: "mcp",
    factory: createMcpExtension(),
    supplies: (tool) => tool.startsWith("mcp__") || MCP_RESOURCE_TOOLS.has(tool),
  },
];
