# AGENTS.md

pi-adhd — pi coding-agent extensions that shape agent output for an ADHD reader: next action first, numbered steps, visible progress, no preamble, no closer. Full user docs live in [README.md](README.md).

## Commands

```bash
npx tsc --noEmit    # typecheck (no build step, no test suite, no linter)
```

There are no test files and no lint config. Verify changes by typechecking, then running `pi -e /path/to/pi-adhd` and exercising the affected command/tool.

## Architecture

A pi extension package. `package.json` exposes one manifest entry (`extensions/index.ts`) plus `themes/*.json`.

- `extensions/index.ts` — the barrel. Reads the `extensions` array in `~/.pi/couralabs/settings.json` and calls only the enabled factories. Load order is deliberate: **ui → agent → tools → providers**. Every extension also stays individually loadable (`pi -e extensions/tools/web/index.ts`).
- `extensions/ui/` — TUI chrome: `editor`, `footer`, `messages`, `session-title`, `thinking`.
- `extensions/agent/` — prompt shaping: `commands` (`/cmd:<name>`), `modes` (`/mode`, Work mode = the ADHD contract), `submodes` (`plan`/`grill`/`straight`, appended prompt sections + tool whitelists).
- `extensions/tools/` — agent tools and their commands: `ask-user`, `job`, `pomodoro`, `spawn`, `timer`, `web`.
- `extensions/providers/claude/` — `claude/*` models backed by the Claude Agent SDK (bridge, tool swap, session host).
- `shared/` — cross-extension helpers (settings, timer registry, spawn service, glyphs, formatting, extension registry). Nothing in `shared/` may import from `extensions/`.
- `.agents/commands/` — saved prompts shipped with the package (e.g. `promote.md`).
- `themes/` — pi theme JSON files.

### Key invariants

- **Extension independence.** Each extension has its own `index.ts` default factory and must work when loaded alone. When one extension consumes state owned by another, it must check `shared/extension-registry.ts` first (`markExtensionLoaded` at factory time, `isExtensionLoaded` before reading) so persisted state from a disabled extension never leaks in.
- **Settings, not globals.** Feature toggles live in `~/.pi/couralabs/settings.json` via `shared/settings.ts`; `/couralabs:toggle` flips them and reloads the set.
- **Mode vs submode.** Modes *replace* pi's system prompt through the `customPrompt` slot; submodes *append* named sections (`<plan_mode>` … + generated `<submode_policy>`). The effective prompt is Mode Prompt + Submode Prompt; neither rewrites the other.
- **Shared registries on `globalThis`.** Cross-instance state (extension registry, timer registry, jobs) is stored under registered symbols so duplicate module instances (jiti reloads, child sessions) share one store — see `shared/store.ts`.

## Code standards

- TypeScript, ESM, `strict: true`, `noEmit`. Imports must end in `.ts` (`allowImportingTsExtensions`) and use `import type` for types (`verbatimModuleSyntax`, `isolatedModules`).
- Indent with **tabs**; no linter enforces style, so match the surrounding code.
- No code comments. The code speaks for itself: use descriptive names, small functions, and clear types instead of prose. This includes file-header doc comments and JSDoc — do not add them, and do not re-add them when editing. Exception: functional directives that tools require (e.g. `// eslint-disable-next-line <rule>`), which stay but carry no explanatory text.
- Keep files small and componentized. One concern per file; extract reusable helpers into `shared/` or a sibling module instead of growing one file. Prefer many small, composable units over a few large ones.
- Runtime deps are minimal (`zod`, `@anthropic-ai/claude-agent-sdk`); pi packages (`@earendil-works/pi-*`, `typebox`) are peer/dev dependencies — import types from them, never add them as runtime deps.
- Extension factories are pure registration functions `export default function registerX(pi: ExtensionAPI): void` that call `markExtensionLoaded("<name>")` first.

## Commits

Conventional-commit style subjects: `feat:`, `fix:`, `docs:` (optionally scoped, e.g. `docs(promote):`). Keep the version bump in `package.json` as its own commit.

## Session output contract

Work mode's rules (see `extensions/agent/modes/prompts/work.md`) are the package's own house style for agent replies: lead with the next action, one bounded action per numbered step, restate state every turn, cap lists, no preamble or closing pleasantries.

---

This is a duplicate of [CLAUDE.md](CLAUDE.md) and both files should always have the same content.
