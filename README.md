# pi-adhd

**ADHD = attention deficit hyperactivity disorder.** `pi-adhd` packages [pi](https://pi.dev) extensions that shape the agent's output for an ADHD reader: the next action first, numbered steps, visible progress, no preamble, no closer.

## Install

```bash
pi install git:github.com/CouraLabs/pi-adhd
```

Other sources:

```bash
pi install /path/to/pi-adhd        # local checkout
pi -e /path/to/pi-adhd             # try without installing
```

Then start `pi`. **Work mode** (the ADHD output contract) is the default.

## 60-second start

1. Run `pi install npm:@couralabs/pi-adhd`.
2. Run `pi`.
3. Confirm the footer starts with `⛑ Work`.
4. Type a request; the first line of the reply is the action.
5. Run `/mode pi` to hear pi's default voice, then `/mode work` to switch back.

About 2 minutes.

![pi-adhd in action: the editor box, working indicator, todo widget, and footer](./demo.png)

## What you get

Eleven extensions, grouped by job. Enable or disable any of them with `/couralabs:enable <extension>` and `/couralabs:disable <extension>`.

| Job | Extension | What it adds |
|---|---|---|
| Shape the reply | `modes` | `/mode [pi\|work]`: swaps the system prompt, footer label, and editor border |
| Shape the reply | `submodes` | `/plan` `/grill` `/straight`: read-only or guided working modes layered on top of the main mode |
| See progress | `footer` | One-line themed status bar: mode, model, thinking, context, cost |
| See progress | `todo` | Phased todo list persisted with the session |
| See progress | `thinking` | Compact animated reasoning preview |
| Drive the loop | `goal` | Persistent autonomous objective with budgets and continuation turns |
| Drive the loop | `spawn` | In-process subagents that run foreground and return inline |
| Ask, don't guess | `ask-user` | `ask` tool: tabbed multi-question dialog |
| Input & output | `editor` | Closed prompt box with `❯` marker and cwd + git location |
| Input & output | `messages` | Left status rule on tool calls |
| Reach the web | `web` | `webfetch` / `websearch`: provider-neutral fetch and search |

## Quick reference: every command

| Command | Does |
|---|---|
| `/mode [pi\|work]` | Switch the system prompt and agent voice |
| `/submode [plan\|grill\|straight\|none]` | Enter or leave a submode |
| `/plan` `/grill` `/straight` | Toggle one submode |
| `/couralabs:enable <extension>` | Enable an extension and reload |
| `/couralabs:disable <extension>` | Disable an extension and reload |
| `/full-cwd [on\|off]` | Show the full working directory or only its last folder |
| `/todo` | View or edit the todo list |
| `/goal` `/guided-goal` | Toggle goal mode; have the agent interview you first |
| `/spawn:settings` `/spawn:sessions` `/spawn:model` | Tune limits, open a transcript, set agent defaults |
| `/web` | Pick web fetch and search providers |

---

## The output contract: `modes`

Two agent modes, switched with `/mode [pi|work]`:

- **⛑ Work** (default) replaces pi's default system prompt with the pi-adhd [Work rules](extensions/agent/modes/prompts/work.md). The rules are the ADHD contract: lead with the next action, number multi-step tasks, restate state every turn, cap lists, no preamble or closers. Work mode also makes the agent an orchestrator — delegate to `spawn` to keep the parent context small, use `ask` before inferring anything unknown, and drive multi-step work with `todo`.
- **π Pi** leaves pi's default system prompt (or a user `SYSTEM.md`) untouched.

The replacement uses pi's `customPrompt` slot, the same mechanism as `SYSTEM.md`, so tool declarations still reach the model while the default preamble is swapped. The active mode shows first in the footer (`π Pi` in the accent color, `⛑ Work` in the default foreground), the prompt field recolors its border (accent for Pi, default border for Work), and the choice persists in the pi-adhd settings file and restores on the next session.

The full Work prompt also covers orchestration: delegate to spawned agents, ask before inferring, and track with `todo`.

## Working modes: `submodes`

Three temporary submodes layered on top of the main mode. Unlike `modes`, which *replaces* the system prompt, a submode **appends** named prompt sections and sets the active tools to the submode's whitelist. Plan and Grill are read-only plus the spawn tools; **Straight keeps the full toolset**, because it is the only submode that may change code.

1. Enter with `/submode plan`, `/submode grill`, or `/submode straight` (or toggle with `/plan`, `/grill`, `/straight`).
2. Read the active submode in the footer next to the mode (`⛑ Work ∙ ⧉Plan`). It persists and restores on the next session.
3. Leave or switch with the `submode-exit` tool (`mode: "exit" | "plan" | "grill" | "straight"`); the current run ends so the target prompt and tools take effect next turn.

The mode prompt and the submode prompt never bleed into each other. The mode replaces pi's preamble through the `customPrompt` slot, and the submode appends its own named section, so the effective system prompt is **Mode Prompt + Submode Prompt** with pi's cwd/context/skills sections still appended. Pi rebuilds the option object from its own base on every run, so a mode swap never leaves a stale submode section behind and a submode never rewrites the mode prompt.

Two sections are appended, in this order:

1. `<plan_mode>` / `<grill_mode>` / `<straight_mode>` — opens with an `ACTIVE SUBMODE: <name>` directive naming the submode and its role, then the prompt from `extensions/agent/submodes/prompts/`.
2. `<submode_policy>` — generated on every run. It lists the exact tools the model may call and names every registered tool that does not exist in this submode. The policy is appended last, so it is the final text of the system prompt.

The whitelist is per submode, and `ask` is dropped in hosts without a UI, where `ask-user` withdraws it:

| Submode | Tools |
| --- | --- |
| ⧉Plan | `read`, `grep`, `find`, `ls`, `ask`, `plan-write`, `submode-exit`, `spawn` |
| 𐂐 Grill | `read`, `grep`, `find`, `ls`, `ask`, `submode-exit`, `spawn` |
| ⛬ Straight | `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `ask`, `todo`, `spawn`, `submode-exit` |

- **⧉Plan** ([plan.md](extensions/agent/submodes/prompts/plan.md)) — the architect. Studies the codebase and submits a concrete, ordered implementation plan for review. It never edits files.
- **𐂐 Grill** ([grill.md](extensions/agent/submodes/prompts/grill.md)) — the designer. Interviews you in rounds across a design tree until you share an understanding, then hands off to Plan (or straight to the coder).
- **⛬ Straight** ([straight.md](extensions/agent/submodes/prompts/straight.md)) — the guided feature-development submode. It asks clarifying questions, explores the codebase, proposes designs, then implements the approved one with the full toolset. It is the only submode that can change code.

### Plan review

While the Plan agent writes the plan, the `plan-write` call streams the plan text inline — a compact tail of up to 10 lines (all when expanded), like the thinking preview — before the full plan opens for review.

`plan-write` blocks the run and opens a fullscreen, line-numbered review pane (a focused overlay in fullscreen TUI mode, docked in regular mode):

```
── Plan review ───────────────────── 42 lines · 1 comment ──
❯ 12  ## Task 2: Wire the queue
  13  - add `src/queue.ts`
  14  - call `enqueue()` from the handler
  15    💬 cover the backpressure case here
  ...
── ↑↓ scroll · c comment · d delete · 1 approve · 2 approve+compact · 3 reject · Esc cancel ──
```

Press `c` on any line to attach a comment, `d` to delete it, and one of three verdicts:

| Key | Verdict | Effect |
|---|---|---|
| `1` / `a` | Approve | Exit the submode; the stored plan is queued as the next prompt and the coder implements it |
| `2` | Approve and Compact | Compact the session, then send the plan as the next prompt |
| `3` / `r` / `Esc` | Reject | Stop the run and wait for you; the line comments are returned to the model |

A rejection's line comments come back as `line N: <comment>` so the model can revise precisely and resubmit. The plan is held in memory for the run, so the Approve and Compact flow can resend it after the session is compacted.

### Plan reviewer agent

The built-in `plan-reviewer` agent is a practical, read-only blocker-finder (`read`, `grep`, `find`, `ls`) that verifies referenced files exist and returns `[OKAY]` or a max-3 `[REJECT]`. It ships as an embedded default, so it is available wherever pi-adhd is installed. The Plan agent spawns it with the `spawn` tool before calling `plan-write` (see [plan.md](extensions/agent/submodes/prompts/plan.md)).

## Prompt field: `editor`

Wraps the prompt editor in a closed field drawn with terminal box characters (`╭ ╮ ╰ ╯ │ ─`), inset by a one-column margin on each side, with a `❯` marker on the first input line. pi's streaming working indicator is embedded in the top border and uses a spinner animation (`🞗` → `🞘` → `🞙` → `🞚` → `🞛` → `🞜` → `🞛` → `🞚` → `🞙` → `🞘`) at 100ms. The working directory and git state are embedded in the bottom border. "Working" is replaced with a random short phrase (max 5 words, from a list of 100) chosen fresh on every turn.

```
 ╭─ 🞘 Consulting the rubber duck ───────────────────────╮
 │ ❯ explain this codebase                              │
 ╰──────────────────────────── pi-adhd ∙ ⌥ main +12 -3 ─╯
```

The box border color follows the active agent mode (see [`modes`](#the-output-contract-modes)): the theme's `border` token in Work, the `accent` token in Pi, instead of tracking the thinking level. The bottom-border location segment shows the working directory followed by the git branch and the added/removed line counts from `git diff --numstat` (`+n` in success green, `-n` in error red). By default only the last folder of the working directory is shown; `/full-cwd` toggles the full path on and off (`/full-cwd on` / `/full-cwd off`), keeping the home directory itself rendered as `~` either way. Enable or disable the whole prompt field with `/couralabs:enable editor` and `/couralabs:disable editor`.

## Status bar: `footer`

Replaces the built-in footer with a compact, theme-aware status bar. Enable or disable it with `/couralabs:enable footer` and `/couralabs:disable footer`.

```
  ⛑ Work ∙ ⧉Plan ∙ anthropic/claude-sonnet-4 ∙ ▶▶ high ∙ [■■■■■■□□□□] 124k/200k (62%) ∙ ↑ 120k ∙ ↓ 8.4k ∙ ⭍ 87% ∙ $0.842
  🎯 Goal 1.2M/2M · 4/10 tasks
```

The stats line shows the active agent mode (see [`modes`](#the-output-contract-modes)) and, when one is active, the submode (see [`submodes`](#working-modes-submodes)) before the current provider/model, thinking level (colored along pi's thinking-level gradient), the context-window gauge, and cumulative input/output/cache/price usage. Statuses published by other extensions via `ctx.ui.setStatus()` (such as the `goal` loop) render on a separate line below. Extensions can also register a section that the footer draws last, below the statuses. Everything adapts to the active theme and degrades gracefully on narrow terminals.

## Tool calls: `messages`

Restyles tool calls to share the pi-adhd look. Built-in tool calls drop their full background and instead show a heavy left rule (`│`) colored with the tool's status background token, so it shifts from pending to success/error exactly like the old shell. Enable or disable it with `/couralabs:enable messages` and `/couralabs:disable messages`.

```
│ read src/index.ts
│ 42 lines
```

The rule reuses the active theme's semantic status colors — `error` for a failed call, `warning` while pending, and `success` on completion — pushed to a bright pastel of the same hue so the thin rule stays legible while the messages UI is active. Deriving it from the semantic colors (rather than the neutral `tool*Bg` fills) keeps the rule green on success in every theme. Toggling affects messages and tool calls rendered after the change; already rendered rows keep their current look until the transcript is rebuilt (for example by resuming or reloading the session).

## Clarifying questions: `ask-user`

Adds the `ask` tool: the model can surface clarifying questions with selectable options. Multi-question calls render as a tabbed dialog with a Submit review page; each option can carry a markdown/code preview, single-select uses radio markers and `multi` uses checkboxes, and an inline `Other` field provides free-form input. An inactivity countdown (`timeoutSeconds`) auto-picks the recommended option, and cancelling aborts the turn. Print/JSON hosts cannot prompt, so the tool is stripped from the active set there. Answers persist in the tool result `details`.

## Autonomous loop: `goal`

Persistent autonomous objective loop. The `goal` tool exposes `create`/`get`/`complete`/`impossible`/`resume`/`drop`; `/goal` toggles goal mode and `/guided-goal` has the agent interview you first. While a goal is active the runtime injects goal context on every request, accounts token and time budget (budget-limit steering once per goal), and schedules continuation turns until a verified `complete`. Interrupting pauses the goal rather than completing it. Emits `goal_updated` for other extensions and consumes `todo_updated` from `todo` to attach live progress. Progress shows in the footer via `ctx.ui.setStatus("goal", …)`.

### Interlocks

Goal mode and the submodes are mutually exclusive. A goal refuses to arm while Plan, Grill, or Straight is active — `/goal`, `/guided-goal`, and the `goal` tool all refuse — and while a goal is armed `/mode`, `/submode`, `/plan`, `/grill`, and `/straight` all refuse to switch, showing the reason as a warning. A goal saved in the session is left unarmed rather than dropped when the interlock blocks a restore; after the submode exits, `/goal resume` arms it.

## Reasoning preview: `thinking`

A vendored, pi-adhd-adapted port of [`pi-compact-thinking`](https://github.com/nostalfinals/pi-compact-thinking): replaces the built-in **hidden** thinking renderer with a compact, animated run. Each run shows an animated heading — the latest OpenAI reasoning-summary title when available, otherwise `Thinking...` — the elapsed time, and a few preview lines. When the body is truncated, the heading gains a `(N more lines, key to expand)` hint:

```
Reviewing the failing test · 4s (12 more lines, shift+tab to expand)
  the assertion expects the handler to be registered before the session starts
  so the ordering must move earlier in the bootstrap
```

When the run finishes the heading settles on `Thought for 4s`. Visible thinking is left exactly as pi renders it, so the thinking-visibility toggle still expands the full reasoning block. Durations render as `ms`, `s`, `m`, or `m Ns`.

Compact mode activates when pi hides thinking (`hideThinkingBlock: true` in pi's settings, and `Shift+Tab` toggles it). The extension patches pi's internal assistant-message renderer — pi exposes no hook for the hidden-thinking body — so it may need updating after a pi upgrade. Enable or disable the extension with `/couralabs:enable thinking` and `/couralabs:disable thinking`.

## Progress list: `todo`

Phased todo lists. The `todo` tool exposes nine operations (`init`/`start`/`done`/`rm`/`drop`/`block`/`unblock`/`append`/`view`) over `phases → tasks` state, persisted with the session and restored branch-aware. `/todo` views or edits the list. It is a cognitive-neutral notepad: statuses change only through explicit ops. Emits `todo_updated` and appends `todo-phases` snapshots for other extensions (consumed by `goal`).

On every run where `todo` is callable, a `todo_upkeep` section is appended to the system prompt: mark an item `in_progress` before starting it, mark it `done` the moment it is finished. It appears in Pi mode, in Work mode, and in Straight (the one submode whose whitelist includes `todo`); Plan and Grill narrow `todo` out of the active tools, so they get no section. The tool's model-facing description ([prompts/todo.md](extensions/tools/todo/prompts/todo.md)) carries the same upkeep cadence, so the guidance is present with the tool schema in every mode.

The list renders as a persistent widget above the prompt editor — a header with overall progress, then each phase with its tasks — updated on every change and restored on session start. Each `todo` call also renders as a single compact row in the transcript, `<icon> todo <action> · <content> <from> → <to>` (e.g. `✓ todo done · "Wire index" in_progress → completed`); a failed call renders in full in the error color instead of vanishing. When every task is closed (completed or abandoned), the list auto-clears and the widget hides, so a finished plan leaves no residue. An unfinished list is live progress state: it persists across runs and is restored with the session until it is finished or replaced (`/todo rm` clears it by hand). Spawn sessions exclude `todo`, so a child can never carry a private, invisible second list.

```
[x] Todo · 4/10 done
I. Planning  2/2
  ├─ [x] Read the spec
  └─ [x] Draft the plan
II. Implementation  2/6
  ├─ [ ] Wire lifecycle
  └─ [ ] Show tool rows
```

## Subagents: `spawn`

In-process autonomous spawned agents, vendored from [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents) (MIT) and restructured to the pi-adhd layout. Agents run inside the same pi runtime — no subprocesses — each in an isolated child session with its own tools, system prompt, model, and thinking level.

The model spawns agents with the `spawn` tool (`spawn_type`, `prompt`, `description`, and optional `model`, `thinking`, `max_turns`, `resume`, `inherit_context`). Every agent runs foreground: the call blocks until the agent finishes and its result comes back inline, so several independent pieces of work are launched in one turn and their results are synthesized as they arrive. `/spawn:settings` tunes turn limits and session retention; `/spawn:sessions` opens a running or completed agent's transcript in pi's read-only viewer.

`/spawn:model` sets a spawned agent's defaults: it lists every agent type — the built-ins `general-purpose`, `plan-reviewer`, `Arquitect`, `Code-Review`, and `Explore` plus the `.agents/agents/*.md` files from the project and `~/.agents/agents/` — annotated with each agent's current model and thinking level, then offers both for the chosen agent. Choosing a model persists it and goes straight to the thinking-level picker, which offers only the levels the chosen model supports (from its `reasoning` flag and `thinkingLevelMap` — a non-reasoning model offers only `off`); esc there keeps the model and leaves thinking untouched. The standalone "Thinking:" action filters the same way, by the agent's already-set model (when that model resolves among the available ones). The dialog loops: after a pick, the agent list returns with the new value shown, so the write is visible without reopening the command; esc exits. Each picker also offers "Inherit (clear override)" to drop an override. A built-in choice is stored in `~/.pi/couralabs/settings.json` under `spawn.agentModels` / `spawn.agentThinking`; a custom agent's choice is written as a `model:` / `thinking:` key in its own markdown frontmatter.

Agent types are defined in `.agents/agents/<name>.md` (project) and `~/.agents/agents/<name>.md` (global) with YAML frontmatter for the prompt, model, thinking level, tools, and `max_turns`. The built-in `general-purpose`, `plan-reviewer`, `Arquitect`, `Code-Review`, and `Explore` types cover the common cases. Lifecycle events (`spawn:started`, `completed`, `failed`, `resuming`, `resumed`, `compacted`, `settings_loaded`, `settings_changed`) are emitted on `pi.events`, and a typed `SpawnService` is published for other extensions.

Disable the whole extension with `/couralabs:disable spawn`; an already-running agent keeps running until it settles, and `/spawn:settings` and `/spawn:sessions` are unavailable in a spawned child session.

## Web access: `web`

Two tools:

- `webfetch({ url, format?, max_characters? })` — fetch a URL as plain text (`format` selects the upstream format; the tool always returns plain text; `max_characters` truncates, default 1000, `0` = unlimited).
- `websearch({ query, search_type?, max_results? })` — search the web (`search_type` is `web` or `news`; `max_results` defaults to 5, max 10).

With the default `auto` provider, each call tries every configured provider in registration order and returns the first success, reporting which provider won and how many others failed. Every request is capped at 30 seconds.

| Service | Providers |
| --- | --- |
| Fetch | `curl` (no key needed — plain HTTPS + HTML-to-text), `jina-reader`, `exa`, `tavily`, `firecrawl`, `ollama`, `youcom`, `9router` |
| Search | `searxng` (no key needed, self-hosted), `exa`, `tavily`, `perplexity`, `serper`, `brave-search`, `youcom`, `google-pse`, `searchapi`, `linkup`, `xquik`, `ollama-search`, `glm`, `9router` |

Each provider names its env vars: `EXA_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`, `OLLAMA_API_KEY` / `OLLAMA_URL`, `YDC_API_KEY`, `NINEROUTER_KEY` / `NINEROUTER_URL`, `SEARXNG_URL`, `PERPLEXITY_API_KEY`, `SERPER_API_KEY`, `BRAVE_API_KEY`, `GOOGLE_PSE_API_KEY` / `GOOGLE_PSE_CX`, `SEARCHAPI_API_KEY`, `LINKUP_API_KEY`, `XQUIK_API_KEY`, `ZAI_API_KEY`. With no keys set, `webfetch` still works through `curl`.

`/web` walks both services: pick the provider from a list that marks unconfigured ones with the env vars they need.

## Configuration

Every pi-adhd setting lives in a single JSON file:

```
~/.pi/couralabs/settings.json
```

It is organized as `{ feature: { option: value } }`, plus a top-level `extensions` array naming which extensions the barrel loads, and is created with the defaults the first time pi-adhd loads, so it always contains the complete set of knobs:

```json
{
  "extensions": [
    "editor",
    "footer",
    "messages",
    "thinking",
    "modes",
    "submodes",
    "ask-user",
    "goal",
    "spawn",
    "todo",
    "web"
  ],
  "editor": { "fullCwd": false },
  "thinking": {
    "useSummaryTitlesAsThinkingTitle": true,
    "previewLines": 5,
    "animationIntervalMs": 90
  },
  "spawn": {
    "defaultMaxTurns": 0,
    "wrapUpTurns": 2,
    "consumedSessionRetentionMinutes": 10,
    "unconsumedSessionRetentionMinutes": 720,
    "excludedExtensionPackages": [],
    "promptInheritance": {},
    "agentModels": {}
  },
  "modes": { "current": "work" },
  "submodes": { "current": "none" },
  "web": {
    "fetch": { "provider": "auto", "nineRouterModel": "exa" },
    "search": { "provider": "auto", "nineRouterModel": "exa" }
  }
}
```

| Feature | Option | Default | Description |
|---|---|---|---|
| `extensions` | — | every extension | Extensions the barrel loads; anything absent is not loaded (edit with `/couralabs:enable` / `/couralabs:disable`) |
| `editor` | `fullCwd` | `false` | Show the full working directory instead of only its last folder (toggle with `/full-cwd`) |
| `thinking` | `useSummaryTitlesAsThinkingTitle` | `true` | Use the latest OpenAI reasoning-summary heading as the live title |
| `thinking` | `previewLines` | `5` | Reasoning-preview lines retained; `0` hides the preview |
| `thinking` | `animationIntervalMs` | `90` | Milliseconds between animation frames while reasoning |
| `spawn` | `defaultMaxTurns` | `0` | Default turn ceiling; `0` = unlimited |
| `spawn` | `wrapUpTurns` | `2` | Turns left when an agent is warned to wrap up |
| `spawn` | `consumedSessionRetentionMinutes` | `10` | Minutes a consumed agent's session is retained |
| `spawn` | `unconsumedSessionRetentionMinutes` | `720` | Minutes an unconsumed agent's session is retained |
| `spawn` | `excludedExtensionPackages` | `[]` | Pi package sources whose extensions child sessions must not load |
| `spawn` | `promptInheritance` | `{}` | Per-provider prompt strategy (`full` or `portable`) |
| `spawn` | `agentModels` | `{}` | Per-built-in-agent model override, set by `/spawn:model` |
| `spawn` | `agentThinking` | `{}` | Per-built-in-agent thinking override, set by `/spawn:model` |
| `modes` | `current` | `"work"` | Active agent mode, restored on session start (toggle with `/mode`) |
| `submodes` | `current` | `"none"` | Active submode, restored on session start (toggle with `/submode`) |
| `web` | `fetch.provider` | `"auto"` | Default web fetch provider; `auto` tries every configured one in order |
| `web` | `fetch.nineRouterModel` | `"exa"` | Model the 9Router aggregator fetches with |
| `web` | `search.provider` | `"auto"` | Default web search provider; `auto` tries every configured one in order |
| `web` | `search.nineRouterModel` | `"exa"` | Model the 9Router aggregator searches with |

The `/couralabs:enable` and `/couralabs:disable` commands rewrite the `extensions` array and reload, so the choice survives reloads and new sessions. Missing keys fall back to the defaults and unknown keys are preserved, so the file can be edited by hand. `/spawn:settings` edits the operational `spawn` options (numeric values open an input prompt).

## Themes

Fourteen themes ship with the package. Select one with `/settings` → **Theme**, or for one run:

```bash
pi --use-theme synthwave84
```

| Theme | Appearance |
|---|---|
| `synthwave84` | Dark — neon '80s palette |
| `aura` | Dark — dark purple palette |
| `cursor-dark` / `cursor-light` | Cursor's dark and light palettes |
| `gruvbox-dark` / `gruvbox-light` | Gruvbox dark and light palettes |
| `matrix-dark` / `matrix-light` | Matrix rain palettes |
| `tokyo-night` | Dark — Tokyo Night Storm |
| `one-dark` | Dark — One Dark Pro |
| `catppuccin-mocha` | Dark — Catppuccin Mocha |
| `dracula` | Dark — Dracula |
| `nord` | Dark — Nord |
| `rose-pine` | Dark — Rosé Pine |

`cursor`, `gruvbox`, and `matrix` each ship as an adaptive `-dark`/`-light` pair. Pair a set in settings to follow the terminal appearance:

```json
{ "theme": "cursor-light/cursor-dark" }
```

## Where to change things

| You want to change… | Edit… |
|---|---|
| The ADHD output rules | `extensions/agent/modes/prompts/work.md` |
| A submode's prompt | `extensions/agent/submodes/prompts/<name>.md` |
| Submode tool whitelists | `extensions/agent/submodes/index.ts` |
| Footer layout | `extensions/ui/footer/render.ts` |
| Prompt box drawing | `extensions/ui/editor/field-editor.ts` |
| Working-message phrases | `extensions/ui/editor/phrases.ts` |
| Todo widget rendering | `extensions/tools/todo/render.ts` |
| Web providers | `extensions/tools/web/providers.ts`, `search-providers.ts` |
| Settings schema and defaults | `shared/settings.ts` |
| Shared UI glyphs | `shared/glyphs.ts` |

## Project layout

```text
pi-adhd/
├── extensions/
│   ├── index.ts             # barrel: loads every extension below (ui → agent → tools)
│   ├── ui/                  # individually loadable UI extensions
│   │   ├── editor/
│   │   │   ├── index.ts         # extension factory: git timers + event wiring
│   │   │   ├── field-editor.ts  # the boxed prompt editor component
│   │   │   ├── git.ts           # branch + `git diff --numstat` parser
│   │   │   ├── phrases.ts       # working-message phrases
│   │   │   └── spinner.ts       # working-indicator animation frames
│   │   ├── footer/
│   │   │   ├── index.ts         # extension factory: usage cache + event wiring
│   │   │   └── render.ts        # pure footer rendering
│   │   ├── messages/
│   │   │   ├── index.ts         # extension factory: renderer wiring
│   │   │   ├── renderers.ts     # tool-renderer wrapper
│   │   │   └── bordered-tool.ts # the left-rule tool component
│   │   └── thinking/
│   │       ├── index.ts         # extension factory: component patch + event wiring
│   │       ├── config.ts        # thinking config backed by couralabs/settings.json
│   │       ├── durations.ts     # per-run duration persistence + restore
│   │       ├── preview.ts       # reasoning-preview component + duration formatting
│   │       ├── summaries.ts     # OpenAI reasoning-summary extraction
│   │       └── types.ts
│   ├── agent/               # individually loadable mode extensions
│   │   ├── modes/
│   │   │   ├── index.ts         # extension factory: `/mode` + prompt swap
│   │   │   └── prompts/         # static .md prompt assets
│   │   └── submodes/
│   │       ├── index.ts         # extension factory: prompt sections + tool policy
│   │       ├── plan-review.ts   # fullscreen plan-review pane
│   │       ├── plan-write.ts    # the `plan-write` tool
│   │       ├── submode-exit.ts  # the `submode-exit` tool
│   │       └── prompts/         # static .md prompt assets
│   └── tools/               # individually loadable tool extensions
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
│       │   ├── todo-bridge.ts   # todo integration
│       │   ├── template.ts      # prompt template renderer
│       │   ├── state.ts
│       │   ├── format.ts
│       │   └── prompts/         # static .md prompt assets
│       ├── spawn/               # vendored from @gotgenes/pi-subagents
│       │   ├── index.ts         # extension factory: wiring + tool/command registration
│       │   ├── runtime.ts       # mutable extension state
│       │   ├── settings.ts      # spawn config backed by couralabs/settings.json
│       │   ├── types.ts
│       │   ├── persisted-record.ts
│       │   ├── debug.ts
│       │   ├── config/          # agent types, custom agents, defaults
│       │   ├── handlers/        # lifecycle
│       │   ├── lifecycle/       # manager, sessions, workspace, limits
│       │   ├── observation/     # events, result delivery
│       │   ├── service/         # typed SpawnService
│       │   ├── session/         # child session assembly
│       │   ├── tools/           # the spawn tool
│       │   └── ui/              # settings, session navigator
│       ├── web/
│       │   ├── index.ts         # extension factory: providers + tools + /web
│       │   ├── webfetch-tool.ts # the `webfetch` tool (inline result preview)
│       │   ├── websearch-tool.ts # the `websearch` tool (inline result preview)
│       │   ├── command.ts       # `/web` provider pickers
│       │   ├── config.ts        # provider settings backed by couralabs/settings.json
│       │   ├── io.ts            # 30s network timeout signal
│       │   ├── util.ts          # small error-formatting helper
│       │   ├── providers.ts     # fetch provider registry + runner
│       │   ├── runner.ts
│       │   ├── builtin.ts       # built-in fetch providers
│       │   ├── public-url.ts    # SSRF-guarded direct fetch (curl provider)
│       │   ├── text.ts          # HTML-to-text
│       │   ├── search-providers.ts # search provider registry + runner
│       │   ├── search-runner.ts
│       │   └── search-builtin.ts   # built-in search providers
│       └── todo/
│           ├── index.ts         # extension factory: tool + command + widget wiring
│           ├── tool.ts          # the `todo` tool (compact transcript rows)
│           ├── commands.ts      # `/todo` command
│           ├── state.ts         # phase/task state + ops
│           ├── render.ts        # persistent widget rendering
│           ├── restore.ts       # session-entry restore
│           └── prompts/         # static .md prompt assets
├── shared/
│   ├── child-sessions.ts    # spawned child-session registry
│   ├── extension-catalog.ts # toggleable extensions and their aliases
│   ├── extension-control.ts # `/couralabs:enable` / `disable` + enabled set
│   ├── extension-registry.ts # which optional pi-adhd extensions are loaded
│   ├── format.ts            # compact token counts + cwd formatting
│   ├── footer-sections.ts   # extra footer blocks registered by extensions
│   ├── glyphs.ts            # shared UI symbols (`❯`, `│`, …)
│   ├── interlock.ts         # goal ↔ submode mutual exclusion
│   ├── labeled-rule.ts      # full-width rule with embedded labels
│   ├── modes.ts             # Pi/Work agent-mode state
│   ├── prompt-sections.ts   # system-prompt section tags shared across extensions
│   ├── settings.ts          # `~/.pi/couralabs/settings.json` load/save
│   ├── spawn-service.ts     # cross-extension spawn service slot
│   ├── store.ts             # process-global value with change notifications
│   ├── submodes.ts          # Plan/Grill/Straight submode state
│   ├── tui-mode.ts          # TUI render-mode probe
│   ├── usage.ts             # cumulative token/cost accounting
│   └── util.ts              # small pure helpers
├── themes/                  # 14 theme JSON files
└── package.json
```

Each extension is a directory whose `index.ts` exports the default factory. Helper modules sit beside it and are imported with explicit `.ts` extensions. Cross-extension helpers live in `shared/`. Extensions are grouped by kind — `extensions/ui/` (editor, footer, messages, thinking), `extensions/agent/` (modes, submodes), and `extensions/tools/` (ask-user, goal, spawn, todo, web) — and every `index.ts` is loadable on its own. The `pi.extensions` manifest in `package.json` points at `extensions/index.ts`, a barrel that reads the enabled set from `~/.pi/couralabs/settings.json` and calls only those factories (ui → agent → tools), so the package loads from a single entry and helper modules are never loaded as extensions on their own. `/couralabs:enable` and `/couralabs:disable` edit that settings array and reload.

### Loading extensions individually

Every extension can be loaded alone (`pi -e extensions/tools/todo/index.ts`), and it degrades gracefully when an extension it cooperates with is absent:

- The `footer` shows spawn cost only when the spawn service is published, and a submode label only when the submodes store is non-empty.
- `goal` reads `todo_updated` events and `todo-phases` entries when `todo` is loaded, and runs without task progress otherwise.
- The `goal` ↔ submode interlock ignores the persisted `submodes.current` unless the submodes extension is loaded (see `shared/extension-registry.ts`), so a value left by an earlier install cannot block goal mode.
- `submodes` filters its tool whitelist against the tools actually registered, so `spawn`, `ask`, and `todo` simply drop out when their extensions are absent.
- The `todo_upkeep` prompt section is added when `todo` is callable and removed by `submodes` whenever the active submode excludes it, regardless of which extension loads first.

## Add your own extension

1. Create `extensions/my-thing/index.ts` (or a single `extensions/my-thing.ts`).
2. Export a default factory receiving `ExtensionAPI`.
3. Run `pi -e ./extensions/my-thing/index.ts` to test it.
4. To ship it with the package, add it to `shared/extension-catalog.ts`, import it in `extensions/index.ts`, and call it from the barrel.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-command", {
    description: "Does a thing",
    handler: async (name, ctx) => ctx.ui.notify("done", "info"),
  });
}
```

The `pi` manifest in `package.json` loads `extensions/index.ts`, so add the factory to that barrel to include it in the package.

## Notes

- No build step: pi loads TypeScript directly via `jiti`.
- Host-provided packages (`@earendil-works/*`, `typebox`) are declared as `peerDependencies` only — never bundle or copy them into `dependencies`.
- Runtime npm dependencies your extensions import go in `dependencies`; pi installs them when the package is installed.
- `devDependencies` exist only for editor type-checking (`npx tsc --noEmit`).

## Based and/or inspired by

- `@xynogen/pix-mono` — https://github.com/xynogen/mono
- `@can1357/oh-my-pi` — https://github.com/can1357/oh-my-pi
- `@gotgenes/pi-packages` — https://github.com/gotgenes/pi-packages
- `@fyeeme/pi-packages` — https://github.com/fyeeme/pi-packages

## Next action

Run `npx tsc --noEmit` from the repo root to confirm the rebrand type-checks.
