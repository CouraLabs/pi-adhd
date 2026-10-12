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

The `ask-user`, `goal`, and `todo` extensions are based on the package
[https://github.com/fyeeme/pi-packages](https://github.com/fyeeme/pi-packages)
(themselves migrations of oh-my-pi), restructured to the pi-pack layout.
Extensions that register tools live under `extensions/tools/`; the rest live
directly under `extensions/`. The `thinking` extension is a vendored,
pi-pack-adapted port of
[`pi-compact-thinking`](https://github.com/nostalfinals/pi-compact-thinking)
(MIT), and `subagents` is vendored from
[`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
(MIT); both are restructured to the same layout.

| Extension | Type | Description |
|---|---|---|
| `modes` | Prompt + events | Pi/Work agent modes: `/mode` swaps the system prompt, footer label, and editor border |
| `submodes` | Prompt + tools + UI | Plan/Grill/Straight submodes that append to the prompt, set the tool set, and review plans fullscreen |
| `footer` | UI + events | One-line themed footer: model, thinking, context, and token/cost usage |
| `editor` | UI + events | Closed prompt box with `❯` marker, joke phrases, and cwd + git location |
| `messages` | UI | Left status rules on tool calls |
| `ask-user` | Tool + UI | `ask` tool: tabbed multi-question dialog with options, previews, and countdown |
| `goal` | Tool + commands + events | Persistent autonomous goal loop with budgets and continuation turns |
| `thinking` | UI | Compact animated reasoning preview for hidden thinking blocks |
| `todo` | Tool + commands + events | Phased todo list persisted with the session |
| `subagents` | Tool + commands + events | In-process autonomous sub-agents with background queue, widget, and transcript viewer |

### `modes`

Two agent modes, switched with `/mode [pi|work]`:

- **⛑ Work** (default) replaces pi's default system prompt with the pi-pack
  [Work rules](../extensions/modes/prompts/work.md): lead with the next
  action, number multi-step tasks, restate state, cap lists, no preamble or
  closers. It also turns the agent into an orchestrator — delegate to
  `subagent` and collect with `get_subagent_result` to keep the parent context
  small, use `ask` before inferring anything unknown, and drive multi-step
  work with `todo`.
- **π Pi** leaves pi's default system prompt (or a user `SYSTEM.md`) untouched.

The replacement uses pi's `customPrompt` slot, the same mechanism as
`SYSTEM.md`, so tool declarations still reach the model while the default
preamble is swapped. The active mode is shown first in the footer (`π Pi` in the
accent color, `⛑ Work` in the default foreground), the prompt field recolors its
border (accent for Pi, the default border for Work), and the choice is
persisted in the pi-pack settings file and restored on the next session.

### `submodes`

Three temporary submodes layered on top of the main mode. Unlike `modes`, which
*replaces* the system prompt, a submode **appends** named prompt sections and
sets the active tools to the submode's whitelist. Plan and Grill are read-only
plus the subagent tools; **Straight keeps the full toolset**, because it is the
only submode that may change code. Enter with `/submode plan` / `/submode grill`
/ `/submode straight` (or toggle with `/plan` / `/grill` / `/straight`); the
active submode shows in the footer next to the mode (`⛑ Work ∙ ⧉Plan`) and is
persisted and restored on the next session.

The mode prompt and the submode prompt never bleed into each other. The mode
replaces pi's preamble through the `customPrompt` slot, and the submode appends
its own named section, so the effective system prompt is **Mode Prompt + Submode
Prompt** with pi's cwd/context/skills sections still appended. Pi rebuilds the
option object from its own base on every run, so a mode swap never leaves a
stale submode section behind and a submode never rewrites the mode prompt.

Two sections are appended, in this order:

1. `<plan_mode>` / `<grill_mode>` / `<straight_mode>` — opens with an
   `ACTIVE SUBMODE: <name>` directive naming the submode and its role, then the
   prompt from `extensions/tools/submodes/prompts/`.
2. `<submode_policy>` — generated on every run. It lists the exact tools the
   model may call and names every registered tool that does not exist in this
   submode. This matters because Work mode replaces pi's built-in tool list with
   its own prose, which names `todo`, `edit`, and `write`. The policy is appended
   last, so it is the final text of the system prompt.

The whitelist is per submode, and `ask` is dropped in hosts without a UI, where
`ask-user` withdraws it:

| Submode | Tools |
| --- | --- |
| ⧉Plan | `read`, `grep`, `find`, `ls`, `ask`, `plan-write`, `submode-exit`, `subagent`, `get_subagent_result`, `steer_subagent` |
| 𐂐 Grill | `read`, `grep`, `find`, `ls`, `ask`, `submode-exit`, `subagent`, `get_subagent_result`, `steer_subagent` |
| ⛬ Straight | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `ask`, `todo`, `subagent`, `get_subagent_result`, `steer_subagent`, `submode-exit` |

- **⧉Plan** (`extensions/tools/submodes/prompts/plan.md`) — the architect.
  Studies the codebase and submits a concrete, ordered implementation plan for
  review. It never edits files.
- **𐂐 Grill** (`extensions/tools/submodes/prompts/grill.md`) — the designer.
  Interviews you in rounds across a design tree until you share an
  understanding, then hands off to Plan (or straight to the coder).
- **⛬ Straight** (`extensions/tools/submodes/prompts/straight.md`) — the guided
  feature-development submode. It asks clarifying questions, explores the
  codebase, proposes designs, then implements the approved one with the full
  toolset. It is the only submode that can change code.

The model leaves or switches submodes with the **`submode-exit`** tool
(`mode: "exit" | "plan" | "grill" | "straight"`); the current run ends so the
target submode's prompt and tools take effect on the next turn.

#### Plan review

While the Plan agent writes the plan, the `plan-write` call streams the plan
text inline — a compact tail of up to 10 lines (all when expanded), like the
thinking preview — before the full plan opens for review.

`plan-write` blocks the run and opens a fullscreen, line-numbered review pane
(a focused overlay in fullscreen TUI mode, docked in regular mode):

```
── Plan review ───────────────────── 42 lines · 1 comment ──
❯ 12  ## Task 2: Wire the queue
  13  - add `src/queue.ts`
  14  - call `enqueue()` from the handler
  15    💬 cover the backpressure case here
  ...
── ↑↓ scroll · c comment · d delete · 1 approve · 2 approve+compact · 3 reject · Esc cancel ──
```

Press `c` on any line to attach a comment, `d` to delete it, and one of three
verdicts:

| Key | Verdict | Effect |
|---|---|---|
| `1` / `a` | Approve | Exit the submode; the stored plan is queued as the next prompt and the coder implements it |
| `2` | Approve and Compact | Compact the session, then send the plan as the next prompt |
| `3` / `r` / `Esc` | Reject | Stop the run and wait for you; the line comments are returned to the model |

A rejection's line comments come back as `line N: <comment>` so the model can
revise precisely and resubmit. The plan is held in memory for the run, so the
Approve and Compact flow can resend it after the session is compacted.

#### Plan reviewer agent

The built-in `plan-reviewer` agent is a practical, read-only blocker-finder
(`read`, `grep`, `find`, `ls`) that verifies referenced files exist and returns
`[OKAY]` or a max-3 `[REJECT]`. It ships as an embedded default, so it is
available wherever pi-pack is installed. The Plan agent spawns it with the
`subagent` tool before calling `plan-write` (see
`extensions/tools/submodes/prompts/plan.md`).

### `editor`

Wraps the prompt editor in a closed field drawn with terminal box characters
(`╭ ╮ ╰ ╯ │ ─`), inset by a one-column margin on each side, with a `❯` marker on
the first input line. pi's streaming working indicator is embedded in the top
border and uses a spinner animation (`🞗` → `🞘` → `🞙` → `🞚` → `🞛` → `🞜` →
`🞛` → `🞚` → `🞙` → `🞘`) at 100ms. The working directory and git state are
embedded in the bottom border. "Working" is replaced with a random short joke
phrase (max 5 words, from a list of 100) chosen fresh on every turn.

```
 ╭───────────────────── 🞘 Consulting the rubber duck ─╮
 │ ❯ explain this codebase                            │
 ╰──────── ~/Projects/CouraLabs/pi-pack ∙ ⌥ main +12 -3 ─╯
```

The box border color follows the active agent mode (see [`modes`](#modes)):
the theme's `border` token in Work, the `accent` token in Pi, instead of
tracking the thinking level. The bottom-border location segment shows the
working directory (home collapsed to `~`) followed by the git branch and the
added/removed line counts from `git diff --numstat` (`+n` in success green,
`-n` in error red). Toggle it at any time with `/prompt-ui` (or
`/prompt-ui on` / `/prompt-ui off`); disabling it restores
pi's default editor and the plain "Working" label.

### `footer`

Replaces the built-in footer with a compact, theme-aware status bar. Toggle it
at any time with `/footer-ui` (or `/footer-ui on` /
`/footer-ui off`).

```
  ⛑ Work ∙ ⧉Plan ∙ anthropic/claude-sonnet-4 ∙ ▶▶ high ∙ [■■■■■■□□□□] 124k/200k (62%) ∙ ↑ 120k ∙ ↓ 8.4k ∙ ⭍ 87% ∙ $0.842
  🎯 Goal 1.2M/2M · 4/10 tasks
```

The stats line shows the active agent mode (see [`modes`](#modes)) and, when
one is active, the submode (see [`submodes`](#submodes)) before the
current provider/model, thinking level (colored along pi's thinking-level
gradient), the context-window gauge, and cumulative input/output/cache/price
usage. Statuses published by other extensions via `ctx.ui.setStatus()` (such as
the `goal` loop) render on a separate line below. Extensions can also register
a section that the footer draws last, below the statuses — the subagents agent
block is one. Everything adapts to the active theme and degrades gracefully on
narrow terminals.

### `messages`

Restyles tool calls to share the pi-pack look. Built-in tool calls drop their
full background and instead show a heavy left rule (`│`) colored with the
tool's status background token, so it shifts from pending to success/error
exactly like the old shell. Toggle it at any time with
`/messages-ui` (or `/messages-ui on` /
`/messages-ui off`).

```
│ read src/index.ts
│ 42 lines
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

### Interlocks

Goal mode and the submodes are mutually exclusive. A goal refuses to arm while
Plan, Grill, or Straight is active — `/goal`, `/guided-goal`, and the `goal` tool
all refuse — and while a goal is armed `/mode`, `/submode`, `/plan`, `/grill`,
and `/straight` all refuse to switch, showing the reason as a warning. A goal saved in the
session is left unarmed rather than dropped when the interlock blocks a restore;
after the submode exits, `/goal resume` arms it.

### `thinking`

A vendored, pi-pack-adapted port of
[`pi-compact-thinking`](https://github.com/nostalfinals/pi-compact-thinking):
replaces the built-in **hidden** thinking renderer with a compact, animated
run. Each run shows an animated heading — the latest OpenAI reasoning-summary
title when available, otherwise `Thinking...` — the elapsed time, and a few
preview lines. When the body is truncated, the heading gains a
`(N more lines, key to expand)` hint:

```
Reviewing the failing test · 4s (12 more lines, shift+tab to expand)
  the assertion expects the handler to be registered before the session starts
  so the ordering must move earlier in the bootstrap
```

When the run finishes the heading settles on `Thought for 4s`. Visible thinking
is left exactly as pi renders it, so the thinking-visibility toggle still
expands the full reasoning block. Durations render as `ms`, `s`, `m`, or
`m Ns`.

Compact mode activates when pi hides thinking (`hideThinkingBlock: true` in
pi's settings, and `Shift+Tab` toggles it). The extension patches pi's internal
assistant-message renderer — pi exposes no hook for the hidden-thinking body —
so it may need updating after a pi upgrade. Toggle the extension itself with
`/thinking-ui` (or `/thinking-ui on` / `/thinking-ui off`);
disabling it restores pi's built-in hidden-thinking label.

### `todo`

Phased todo lists, ported from oh-my-pi. The `todo` tool exposes nine
operations (`init`/`start`/`done`/`rm`/`drop`/`block`/`unblock`/`append`/`view`)
over `phases → tasks` state, persisted with the session and restored
branch-aware. `/todo` views or edits the list. It is a cognitive-neutral
notepad: statuses change only through explicit ops. Emits `todo_updated` and
appends `todo-phases` snapshots for other extensions (consumed by `goal`).

On every run where `todo` is callable, a `todo_upkeep` section is appended to
the system prompt: mark an item `in_progress` before starting it, mark it `done`
the moment it is finished. It appears in Pi mode, in Work mode, and in Straight
(the one submode whose whitelist includes `todo`); Plan and Grill narrow `todo`
out of the active tools, so they get no section. The tool's model-facing
description (`prompts/todo.md`) carries the same upkeep cadence, so the
guidance is present with the tool schema in every mode.

The list renders as a persistent widget above the prompt editor — a header with
overall progress, then each phase with its tasks — updated on every change and
restored on session start. Each `todo` call also renders as a compact dim row
in the transcript (e.g. `✓ done · "Wire index" in_progress → completed`); a
failed call renders in full in the error color instead of vanishing. When every
task is closed (completed or abandoned), the list auto-clears and the widget
hides, so a finished plan leaves no residue. An unfinished list is live
progress state: it persists across runs and is restored with the session until
it is finished or replaced (`/todo rm` clears it by hand). Subagent sessions
exclude `todo`, so a child can never carry a private, invisible second list.

```
[x] Todo · 4/10 done
I. Planning  2/2
  ├─ [x] Read the spec
  └─ [x] Draft the plan
II. Implementation  2/6
  ├─ [ ] Wire lifecycle
  └─ [ ] Show tool rows
```

### `subagents`

In-process autonomous sub-agents, vendored from
[`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
(MIT) and restructured to the pi-pack layout. Agents run inside the same pi
runtime — no subprocesses — each in an isolated child session with its own
tools, system prompt, model, and thinking level.

The model spawns agents with the `subagent` tool (`subagent_type`, `prompt`,
`description`, and optional `model`, `thinking`, `max_turns`,
`run_in_background`, `resume`, `inherit_context`), collects background results
with `get_subagent_result`, and redirects a running agent with
`steer_subagent`. Background agents are queued against a concurrency limit
(default 4) and render in a persistent block at the bottom of the pi-pack
footer with live spinners, tool activity, token counts, and status icons;
completion notices render as themed boxes. `/subagents:settings` tunes
concurrency, turn limits, session retention, and the abort-on-interrupt policy;
`/subagents:sessions` opens a running or completed agent's transcript in pi's
read-only viewer.

`/subagent-model` sets a subagent's default model: it lists every subagent —
the built-ins `general-purpose`, `plan-reviewer`, `Arquitect`,
`Code-Review`, and `Explore` plus the `.agents/agents/*.md`
files from the project and `~/.agents/agents/` — then the available models. A
built-in choice is stored in `~/.pi/couralabs/settings.json` under
`subagents.agentModels`; a custom agent's choice is written as a `model:` key in
its own markdown frontmatter.

Every discovered agent also gets a `/delegate:<agent-name> <prompt>` command
that spawns it in the foreground with the given prompt and delivers the result
into the conversation exactly like a tool-spawned completion — the same
`subagent-notification` message and renderer. The command name preserves the
agent's case, because pi's command dispatch is exact-match and case-sensitive:
`Explore` registers as `/delegate:Explore`, not `/delegate:explore`. An agent
whose name contains a space cannot be addressed (pi ends a command name at the
first space), so it is skipped and the skipped names are reported once. Commands
are registered at load and re-scanned on every `session_start`, so agents added
while pi is running appear without a restart.

Agent types are defined in `.agents/agents/<name>.md` (project) and
`~/.agents/agents/<name>.md` (global) with YAML frontmatter for the prompt,
model, thinking level, tools, and `max_turns`. The built-in `general-purpose`,
`plan-reviewer`, `Arquitect`, `Code-Review`, and `Explore` types cover the
common cases. Lifecycle events
(`subagents:created`, `started`, `completed`, `failed`, `resuming`, `resumed`,
`steered`, `compacted`, `settings_loaded`, `settings_changed`) are emitted on
`pi.events`, and a typed `SubagentsService` is published for other extensions.

Toggle the whole extension with `/subagents` (or
`/subagents on` / `/subagents off`). Disabling removes the
`subagent`, `get_subagent_result`, and `steer_subagent` tools from the active
set, clears the widget, and makes `/subagents:settings` and
`/subagents:sessions` report that subagents are disabled; the choice persists
across reloads. Already-running agents keep running.

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
  "messages": { "enabled": true },
  "thinking": {
    "enabled": true,
    "useSummaryTitlesAsThinkingTitle": true,
    "previewLines": 5,
    "animationIntervalMs": 90
  },
  "subagents": {
    "enabled": true,
    "maxConcurrent": 4,
    "defaultMaxTurns": 0,
    "wrapUpTurns": 2,
    "consumedSessionRetentionMinutes": 10,
    "unconsumedSessionRetentionMinutes": 720,
    "abortAllOnInterrupt": true,
    "midRunUpdates": true,
    "excludedExtensionPackages": [],
    "promptInheritance": {},
    "agentModels": {}
  },
  "modes": { "current": "work" },
  "submodes": { "current": "none" }
}
```

| Feature | Option | Default | Description |
|---|---|---|---|
| `footer` | `enabled` | `true` | pi-pack footer (toggle with `/footer-ui`) |
| `editor` | `enabled` | `true` | pi-pack prompt field (toggle with `/prompt-ui`) |
| `messages` | `enabled` | `true` | pi-pack message UI (toggle with `/messages-ui`) |
| `thinking` | `enabled` | `true` | Compact hidden-thinking renderer (toggle with `/thinking-ui`) |
| `thinking` | `useSummaryTitlesAsThinkingTitle` | `true` | Use the latest OpenAI reasoning-summary heading as the live title |
| `thinking` | `previewLines` | `5` | Reasoning-preview lines retained; `0` hides the preview |
| `thinking` | `animationIntervalMs` | `90` | Milliseconds between animation frames while reasoning |
| `subagents` | `enabled` | `true` | pi-pack subagents and their tools (toggle with `/subagents`) |
| `subagents` | `maxConcurrent` | `4` | Background agents running at once; the rest queue |
| `subagents` | `defaultMaxTurns` | `0` | Default turn ceiling; `0` = unlimited |
| `subagents` | `wrapUpTurns` | `2` | Turns left when an agent is warned to wrap up |
| `subagents` | `consumedSessionRetentionMinutes` | `10` | Minutes a consumed agent's session is retained |
| `subagents` | `unconsumedSessionRetentionMinutes` | `720` | Minutes an unconsumed agent's session is retained |
| `subagents` | `abortAllOnInterrupt` | `true` | Whether ESC aborts background agents |
| `subagents` | `midRunUpdates` | `true` | Whether background children can interrupt the parent mid-run |
| `subagents` | `excludedExtensionPackages` | `[]` | Pi package sources whose extensions child sessions must not load |
| `subagents` | `promptInheritance` | `{}` | Per-provider prompt strategy (`full` or `portable`) |
| `subagents` | `agentModels` | `{}` | Per-built-in-agent model override, set by `/subagent-model` |
| `modes` | `current` | `"work"` | Active agent mode, restored on session start (toggle with `/mode`) |
| `submodes` | `current` | `"none"` | Active submode, restored on session start (toggle with `/submode`) |

The `on`/`off` forms of each toggle write the new value back to this file, so
the choice survives reloads and new sessions. Missing keys fall back to the
defaults and unknown keys are preserved, so the file can be edited by hand.
`/subagents:settings` edits the operational `subagents` options
(numeric values open an input prompt; the two booleans flip in place).

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
│   ├── editor/
│   │   ├── index.ts         # extension factory: git timers + event wiring
│   │   ├── field-editor.ts  # the boxed prompt editor component
│   │   ├── git.ts           # branch + `git diff --numstat` parser
│   │   ├── jokes.ts         # working-message phrases
│   │   └── spinner.ts       # working-indicator animation frames
│   ├── footer/
│   │   ├── index.ts         # extension factory: usage cache + event wiring
│   │   └── render.ts        # pure footer rendering
│   ├── messages/
│   │   ├── index.ts         # extension factory: renderer wiring
│   │   ├── renderers.ts     # tool-renderer wrapper
│   │   └── bordered-tool.ts # the left-rule tool component
│   ├── modes/
│   │   ├── index.ts         # extension factory: `/mode` + prompt swap
│   │   └── prompts/         # static .md prompt assets
│   ├── thinking/
│   │   ├── index.ts         # extension factory: component patch + event wiring
│   │   ├── config.ts        # thinking config backed by couralabs/settings.json
│   │   ├── durations.ts     # per-run duration persistence + restore
│   │   ├── preview.ts       # reasoning-preview component + duration formatting
│   │   ├── summaries.ts     # OpenAI reasoning-summary extraction
│   │   └── types.ts
│   └── tools/
│       ├── ask-user/
│       │   ├── index.ts         # `ask` tool + renderers
│       │   ├── ask-dialog.ts    # tabbed multi-question dialog
│       │   ├── ask-legacy.ts    # per-question selector fallback
│       │   ├── countdown-timer.ts
│       │   ├── overlay-box.ts
│       │   ├── compat.ts
│       │   └── types.ts
│       ├── goal/
│       │   ├── index.ts         # goal mode wiring + continuation loop
│       │   ├── runtime.ts       # goal state machine + budget accounting
│       │   ├── tool.ts          # the `goal` tool
│       │   ├── commands.ts      # `/goal` + `/guided-goal`
│       │   ├── evaluator.ts     # completion evaluator
│       │   ├── restore.ts       # session-entry restore
│       │   ├── todo-bridge.ts   # pi-todo integration
│       │   ├── template.ts      # prompt template renderer
│       │   ├── state.ts
│       │   ├── format.ts
│       │   └── prompts/         # static .md prompt assets
│       ├── subagents/           # vendored from @gotgenes/pi-subagents
│       │   ├── index.ts         # extension factory: wiring + tool/command registration
│       │   ├── runtime.ts       # mutable extension state
│       │   ├── settings.ts      # subagents config backed by couralabs/settings.json
│       │   ├── types.ts
│       │   ├── persisted-record.ts
│       │   ├── debug.ts
│       │   ├── config/          # agent types, custom agents, defaults
│       │   ├── handlers/        # lifecycle, interrupt, widget events
│       │   ├── lifecycle/       # manager, sessions, workspace, limits
│       │   ├── observation/     # events, notifications, result delivery
│       │   ├── service/         # typed SubagentsService
│       │   ├── session/         # child session assembly
│       │   ├── tools/           # subagent / get-result / steer tools
│       │   └── ui/              # widget, settings, session navigator
│       ├── submodes/
│       │   ├── index.ts         # extension factory: prompt sections + tool policy
│       │   ├── plan-review.ts   # fullscreen plan-review pane
│       │   ├── plan-write.ts    # the `plan-write` tool
│       │   ├── submode-exit.ts  # the `submode-exit` tool
│       │   └── prompts/         # static .md prompt assets
│       └── todo/
│           ├── index.ts         # extension factory: tool + command + widget wiring
│           ├── tool.ts          # the `todo` tool (compact transcript rows)
│           ├── commands.ts      # `/todo` command
│           ├── state.ts         # phase/task state + ops
│           ├── render.ts        # persistent widget rendering
│           ├── restore.ts       # session-entry restore
│           └── prompts/         # static .md prompt assets
├── shared/
│   ├── child-sessions.ts    # subagent child-session registry
│   ├── format.ts            # compact token counts + cwd formatting
│   ├── glyphs.ts            # shared UI symbols (`❯`, `│`, …)
│   ├── interlock.ts         # goal ↔ submode mutual exclusion
│   ├── labeled-rule.ts      # full-width rule with embedded labels
│   ├── modes.ts             # Pi/Work agent-mode state
│   ├── settings.ts          # `~/.pi/couralabs/settings.json` load/save
│   ├── store.ts             # process-global value with change notifications
│   ├── subagents-service.ts # cross-extension subagents service slot
│   ├── submodes.ts          # Plan/Grill/Straight submode state
│   ├── tui-mode.ts          # TUI render-mode probe
│   ├── usage.ts             # cumulative token/cost accounting
│   └── util.ts              # small pure helpers
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
Cross-extension helpers live in `shared/`. Extensions that register tools live
under `extensions/tools/`. The `pi.extensions` manifest in `package.json`
matches only `extensions/*.ts`, `extensions/*/index.ts`, and
`extensions/tools/*/index.ts`, so helper modules are never loaded as extensions
on their own.

## Adding an extension

Drop a `.ts` file in `extensions/` (or a subdirectory with an `index.ts`; tool
extensions live under `extensions/tools/`). It is picked up automatically via
the `pi` manifest in `package.json`. Each entry point exports a default factory
receiving `ExtensionAPI`:

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
pi --extension ./extensions/tools/subagents/index.ts
```

## Notes

- No build step: pi loads TypeScript directly via `jiti`.
- Host-provided packages (`@earendil-works/*`, `typebox`) are declared as
  `peerDependencies` only — never bundle or copy them into `dependencies`.
- Runtime npm dependencies your extensions import go in `dependencies`;
  pi installs them when the package is installed.
- `devDependencies` exist only for editor type-checking (`npx tsc --noEmit`).
