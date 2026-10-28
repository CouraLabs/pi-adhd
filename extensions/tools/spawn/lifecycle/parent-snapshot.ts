import type { Model } from "@earendil-works/pi-ai";
import { buildParentContext } from "../session/context.ts";
import type { ModelRegistry } from "../../../../shared/model-resolver.ts";
import type { SessionContext } from "../types.ts";

export interface ParentPromptOptions {

  customPrompt?: string;

  appendSystemPrompt?: string;
}

export interface ParentSnapshot {

  cwd: string;

  systemPrompt: string;

  model: Model<any> | undefined;

  modelRegistry: ModelRegistry;

  parentContext?: string;

  portablePrompt?: string;
}

export function buildParentSnapshot(
  ctx: SessionContext,
  inheritContext?: boolean,
  promptOptions?: ParentPromptOptions,
): ParentSnapshot {
  const parentContext = inheritContext ? buildParentContext(ctx) : undefined;
  return {
    cwd: ctx.cwd,
    systemPrompt: ctx.getSystemPrompt(),
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,

    parentContext: parentContext || undefined,
    portablePrompt: buildPortablePrompt(promptOptions),
  };
}

function buildPortablePrompt(options?: ParentPromptOptions): string | undefined {
  if (!options) return undefined;
  const sections: string[] = [];
  const custom = options.customPrompt?.trim();
  if (custom) sections.push(custom);
  const appended = options.appendSystemPrompt?.trim();
  if (appended) sections.push(`<addendum>\n${appended}\n</addendum>`);
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}
