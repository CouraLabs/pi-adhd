# pi-pack

A collection of [pi](https://pi.dev) extensions, packaged for easy installation.

## Demo

![pi-pack in action: the editor box, working indicator, todo widget, and footer](./demo.png)

## Install

```bash
# locally (while developing)
pi install ./pi-pack

# from npm or git once published
pi install npm:pi-pack
pi install git:github.com/CouraLabs/pi-pack
```

Try without installing:

```bash
pi -e ./pi-pack
```

## Extensions

The `ask-user`, `goal`, `thinking`, and `todo` extensions are based on the
package [https://github.com/fyeeme/pi-packages](https://github.com/fyeeme/pi-packages)
(themselves migrations of oh-my-pi), restructured to the pi-pack layout.

| Extension | Type | Description |
|---|---|---|
| `footer` | UI + events | One-line themed footer: model, thinking, context, and token/cost usage |
| `editor` | UI + events | Closed prompt box with `⟫` marker, joke phrases, and cwd + git location |
| `messages` | UI | Left status rules on tool calls and a `⟫` chevron on user messages |
| `ask-user` | Tool + UI | `ask` tool: tabbed multi-question dialog with options, previews, and countdown |
| `goal` | Tool + commands + events | Persistent autonomous goal loop with budgets and continuation turns |
| `thinking` | UI | Summary view of the model's reasoning: role icons + key steps |
| `todo` | Tool + commands + events | Phased todo list persisted with the session |

### `editor`

Wraps the prompt editor in a closed field drawn with terminal box characters
(`╭ ╮ ╰ ╯ │ ─`), inset by a one-column margin on each side, with a `⟫` marker on
the first input line. pi's streaming working indicator is embedded in the top
border and uses a dot animation (`···` → `•··` → `••·` → `•••` → `·••` → `··•`)
at 100ms. The working directory and git state are embedded in the bottom
border. "Working" is replaced with a random short joke phrase (max 5 words,
from a list of 100) chosen fresh on every turn.

```
 ╭─────────────────── ••· Consulting the rubber duck ─╮
 │ ⟫ explain this codebase                            │
 ╰──────── ~/Projects/CouraLabs/pi-pack ⫶ ⌥ main +12 -3 ─╯
```

The box keeps a fixed border color (the theme's `border` token) instead of
tracking the thinking level, so it no longer shifts with the active reasoning
level. The bottom-border location segment shows the working directory (home
collapsed to `~`) followed by the git branch and the added/removed line counts
from `git diff --numstat` (`+n` in success green, `-n` in error red). Toggle it
at any time with `/couralabs-prompt-ui` (or `/couralabs-prompt-ui on` /
`/couralabs-prompt-ui off`); disabling it restores pi's default editor and the
plain "Working" label.

### `footer`

Replaces the built-in footer with a compact, theme-aware status bar. Toggle it
at any time with `/couralabs-footer-ui` (or `/couralabs-footer-ui on` /
`/couralabs-footer-ui off`).

```
  anthropic/claude-sonnet-4 ⫶ ▶▶ high ⫶ █████░░░ 124k/200k (62%) ⫶ ↑120k ⫶ ↓8.4k ⫶ ⮎ 87% ⫶ $0.842
  🎯 Goal 1.2M/2M · 4/10 tasks
```

The stats line shows the current provider/model, thinking level (colored along
pi's thinking-level gradient), the context-window gauge, and cumulative
input/output/cache/price usage. Statuses published by other extensions via
`ctx.ui.setStatus()` (such as the `goal` loop) render on a separate line below.
Everything adapts to the active theme and degrades gracefully on narrow
terminals.

### `messages`

Restyles the transcript so tool calls and user messages share the pi-pack look.
Built-in tool calls drop their full background and instead show a heavy left
rule (`┃`) colored with the tool's status background token, so it shifts from
pending to success/error exactly like the old shell. User messages get the same
`⟫` chevron as the prompt editor. Toggle it at any time with
`/couralabs-messages-ui` (or `/couralabs-messages-ui on` /
`/couralabs-messages-ui off`).

```
┃ read src/index.ts
┃ 42 lines
⟫ explain this codebase
```

The rule reuses the active theme's semantic status colors — `error` for a
failed call, `warning` while pending, and `success` on completion — pushed to a
bright pastel of the same hue so the thin rule stays legible while the messages
UI is active. Deriving it from the semantic colors (rather than the neutral
`tool*Bg` fills) keeps the rule green on success in every theme. Toggling affects
messages and tool calls rendered after the change; already rendered rows keep
their current look until the transcript is rebuilt (for example by resuming or
reloading the session).

### `ask-user`

Adds the oh-my-pi `ask` tool: the model can surface clarifying questions with
selectable options. Multi-question calls render as a tabbed dialog with a
Submit review page; each option can carry a markdown/code preview, single-select
uses radio markers and `multi` uses checkboxes, and an inline `Other` field
provides free-form input. An inactivity countdown (`timeoutSeconds`) auto-picks
the recommended option, and cancelling aborts the turn. Print/JSON hosts cannot
prompt, so the tool is stripped from the active set there. Answers persist in
the tool result `details`.

### `goal`

Persistent autonomous objective loop, ported from oh-my-pi. The `goal` tool
exposes `create`/`get`/`complete`/`impossible`/`resume`/`drop`; `/goal` toggles
goal mode and `/guided-goal` has the agent interview you first. While a goal is
active the runtime injects goal context on every request, accounts token and
time budget (budget-limit steering once per goal), and schedules continuation
turns until a verified `complete`. Interrupting pauses the goal rather than
completing it. Emits `goal_updated` for other extensions and consumes
`todo_updated` from `todo` to attach live progress. Progress shows in the footer
via `ctx.ui.setStatus("goal", …)`.

### `thinking`

Replaces pi's built-in thinking renderer with a summary view: each completed
step is classified with a semantic role icon and a short extractive sentence,
rendered one per line under a heading that reports the elapsed reasoning
time — `# Reasoning - 3s` while streaming, `# Thoughts - 1m5s` once the
run finishes.
Durations render as `ms`, `s`, `m`s`, or `h`m`s`. No configuration or mode
switching — installing the extension is the whole setup.

While a message streams, the summary is built incrementally at most once per
second: completed paragraphs are classified and appended, so the visible list
only grows and the O(n²) derivation runs on a fixed cadence instead of on every
token. It falls back to the raw stream until the first paragraph completes, then
converges on the finalize view. The full derivation runs once the block
finalizes and is memoized for later re-renders.

Collapsed thinking blocks bypass the transformer, so while a run is streaming
their label shows the latest completed summary item instead of the static
`Thinking...`. Because updating that label makes pi rebuild every assistant
message in the transcript, it is only driven when thinking is collapsed (visible
thinking is drawn by the transformer) and on a two-second cadence; the default
label is restored when the message ends.

### `todo`

Phased todo lists, ported from oh-my-pi. The `todo` tool exposes nine
operations (`init`/`start`/`done`/`rm`/`drop`/`block`/`unblock`/`append`/`view`)
over `phases → tasks` state, persisted with the session and restored
branch-aware. `/todo` views or edits the list. It is a cognitive-neutral
notepad: statuses change only through explicit ops. Emits `todo_updated` and
appends `todo-phases` snapshots for other extensions (consumed by `goal`).

The list renders as a persistent widget above the prompt editor — a header with
overall progress, then each phase with its tasks — updated on every change and
restored on session start. The `todo` tool call itself is hidden from the
transcript, so the plan stays visible without scrolling past tool blocks. When
every task is closed (completed or abandoned), the list auto-clears and the
widget hides, so a finished plan leaves no residue; any leftover unfinished
list is also cleared when the assistant ends a turn with a final reply (a
assistant message with no tool calls). Intermediate tool-call turns keep it:

```
☑ Todo · 4/10 done
I. Planning  2/2
  ├─ ☑ Read the spec
  └─ ☑ Draft the plan
II. Implementation  2/6
  ├─ ☐ Wire lifecycle
  └─ ☐ Hide tool calls
```

## Configuration

Every pi-pack setting lives in a single JSON file:

```
~/.pi/couralabs/settings.json
```

It is organized as `{ feature: { option: value } }` and created with the
defaults the first time pi-pack loads, so it always contains the complete set
of knobs:

```json
{
  "footer": { "enabled": true },
  "editor": { "enabled": true },
  "messages": { "enabled": true }
}
```

| Feature | Option | Default | Description |
|---|---|---|---|
| `footer` | `enabled` | `true` | pi-pack footer (toggle with `/couralabs-footer-ui`) |
| `editor` | `enabled` | `true` | pi-pack prompt field (toggle with `/couralabs-prompt-ui`) |
| `messages` | `enabled` | `true` | pi-pack message UI (toggle with `/couralabs-messages-ui`) |

The `on`/`off` forms of each toggle write the new value back to this file, so
the choice survives reloads and new sessions. Missing keys fall back to the
defaults and unknown keys are preserved, so the file can be edited by hand.

## Themes

| Theme | Appearance | Description |
|---|---|---|
| `synthwave84` | Dark | Neon '80s palette ported from the SynthWave '84 / opencode theme |
| `aura` | Dark | Dark purple palette ported from the Aura / opencode theme |
| `cursor-dark` | Dark | Cursor's dark palette ported from the opencode theme |
| `cursor-light` | Light | Cursor's light palette ported from the opencode theme |
| `gruvbox-dark` | Dark | Gruvbox dark palette ported from the opencode theme |
| `gruvbox-light` | Light | Gruvbox light palette ported from the opencode theme |
| `matrix-dark` | Dark | Matrix rain palette ported from the opencode theme |
| `matrix-light` | Light | Matrix rain palette ported from the opencode theme |

`cursor`, `gruvbox`, and `matrix` each ship as an adaptive `-dark`/`-light`
pair. Pair a set in settings to follow the terminal appearance:

```json
{ "theme": "cursor-light/cursor-dark" }
```

Select it with `/settings` → **Theme**, or for one run:

```bash
pi --use-theme synthwave84
```

## Project layout

```text
pi-pack/
├── extensions/
│   ├── ask-user/
│   │   ├── index.ts         # `ask` tool + renderers
│   │   ├── ask-dialog.ts    # tabbed multi-question dialog
│   │   ├── ask-legacy.ts    # per-question selector fallback
│   │   ├── countdown-timer.ts
│   │   ├── overlay-box.ts
│   │   ├── compat.ts
│   │   └── types.ts
│   ├── editor/
│   │   ├── index.ts         # extension factory: git timers + event wiring
│   │   ├── field-editor.ts  # the boxed prompt editor component
│   │   ├── git.ts           # branch + `git diff --numstat` parser
│   │   ├── jokes.ts         # working-message phrases
│   │   └── spinner.ts       # working-indicator animation frames
│   ├── footer/
│   │   ├── index.ts         # extension factory: usage cache + event wiring
│   │   └── render.ts        # pure footer rendering
│   ├── goal/
│   │   ├── index.ts         # goal mode wiring + continuation loop
│   │   ├── runtime.ts       # goal state machine + budget accounting
│   │   ├── tool.ts          # the `goal` tool
│   │   ├── commands.ts      # `/goal` + `/guided-goal`
│   │   ├── evaluator.ts     # completion evaluator
│   │   ├── restore.ts       # session-entry restore
│   │   ├── todo-bridge.ts   # pi-todo integration
│   │   ├── template.ts      # prompt template renderer
│   │   ├── state.ts
│   │   ├── format.ts
│   │   └── prompts/         # static .md prompt assets
│   ├── messages/
│   │   ├── index.ts         # extension factory: renderer + transformer wiring
│   │   ├── renderers.ts     # tool-renderer wrapper
│   │   └── bordered-tool.ts # the left-rule tool component
│   ├── thinking/
│   │   ├── index.ts         # extension factory: markdown-transformer wiring
│   │   ├── parse.ts         # thinking-block parsing + step classification
│   │   ├── markdown-render.ts # summary rendering + incremental stream state
│   │   └── types.ts
│   └── todo/
│       ├── index.ts         # extension factory: tool + command + widget wiring
│       ├── tool.ts          # the `todo` tool (transcript call hidden)
│       ├── commands.ts      # `/todo` command
│       ├── state.ts         # phase/task state + ops
│       ├── render.ts        # persistent widget rendering
│       ├── restore.ts       # session-entry restore
│       └── prompts/         # static .md prompt assets
├── shared/
│   ├── format.ts            # compact token counts + cwd formatting
│   ├── glyphs.ts            # shared UI symbols (`⟫`, `┃`, …)
│   ├── settings.ts          # `~/.pi/couralabs/settings.json` load/save
│   └── usage.ts             # cumulative token/cost accounting
├── themes/
│   ├── aura.json
│   ├── cursor-dark.json
│   ├── cursor-light.json
│   ├── gruvbox-dark.json
│   ├── gruvbox-light.json
│   ├── matrix-dark.json
│   ├── matrix-light.json
│   └── synthwave84.json
└── package.json
```

Each extension is a directory whose `index.ts` exports the default factory.
Helper modules sit beside it and are imported with explicit `.ts` extensions.
Cross-extension helpers live in `shared/`. The `pi.extensions` manifest in
`package.json` matches only `extensions/*.ts` and `extensions/*/index.ts`, so
helper modules are never loaded as extensions on their own.

## Adding an extension

Drop a `.ts` file in `extensions/` (or a subdirectory with an `index.ts`). It is
picked up automatically via the `pi` manifest in `package.json`. Each entry
point exports a default factory receiving `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-command", {
    description: "Does a thing",
    handler: async (name, ctx) => ctx.ui.notify("done", "info"),
  });
}
```

Test a single extension during development:

```bash
pi --extension ./extensions/footer/index.ts
```

## Notes

- No build step: pi loads TypeScript directly via `jiti`.
- Host-provided packages (`@earendil-works/*`, `typebox`) are declared as
  `peerDependencies` only — never bundle or copy them into `dependencies`.
- Runtime npm dependencies your extensions import go in `dependencies`;
  pi installs them when the package is installed.
- `devDependencies` exist only for editor type-checking (`npx tsc --noEmit`).
