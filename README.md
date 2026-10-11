# pi-pack

A collection of [pi](https://pi.dev) extensions, packaged for easy installation.

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

| Extension | Type | Description |
|---|---|---|
| `footer` | UI + events | Rich themed footer: model, context gauge, git, counters |
| `editor` | UI + events | Closed prompt box with `❯` marker, joke phrases, and token usage |
| `messages` | UI | Left status rules on tool calls and a `❯` chevron on user messages |

### `editor`

Wraps the prompt editor in a closed box with side borders and a `❯` marker on
the left. pi's streaming working indicator moves to the top-right of the box
and uses a dot animation (`···` → `•··` → `••·` → `•••` → `·••` → `··•`) at
100ms, colored to match the editor border. The cumulative token/cost usage sits
at the far right of the bottom rule. "Working" is replaced with a random short
joke phrase (max 5 words, from a list of 100) chosen fresh on every turn.

```
──────────────── ••· Consulting the rubber duck ─
❯ explain this codebase
──────────────────── ↑120k · ↓8.4k ·  87% · $0.842 ─
```

The editor is bounded by a top and bottom rule only, with the `❯` marker on the
left. The box rules keep pi's thinking-level color (and bash-mode color), so
they shift with the active reasoning level just like the default editor. The
usage segments match the pi-pack footer. Toggle it at any time with
`/couralabs-prompt-ui` (or `/couralabs-prompt-ui on` /
`/couralabs-prompt-ui off`); disabling it restores pi's default editor and the
plain "Working" label.

### `footer`

Replaces the built-in footer with a compact, theme-aware status bar. Toggle it
at any time with `/couralabs-footer-ui` (or `/couralabs-footer-ui on` /
`/couralabs-footer-ui off`).

```
anthropic/claude-sonnet-4 · ⚙ high · █████░░░ 124k/200k (62%)
⎇ main ↑2 ↓1 ✚3 ?1 · ~/Projects/CouraLabs/pi-pack · 7 turns · 12 tools
```

It shows the current provider/model, thinking level (colored to match the
editor border), the context-window gauge, git branch, ahead/behind,
changed/untracked/conflict counts, working directory, turn/tool counters, and
statuses published by other extensions via `ctx.ui.setStatus()`. Everything
adapts to the active theme and degrades gracefully on narrow terminals. The
cumulative token/cost usage lives on the prompt editor instead (see `editor`
above).

### `messages`

Restyles the transcript so tool calls and user messages share the pi-pack look.
Built-in tool calls drop their full background and instead show a thick left
rule (`▌`) colored with the tool's status background token, so it shifts from
pending to success/error exactly like the old shell. User messages get the same
`❯` chevron as the prompt editor. Toggle it at any time with
`/couralabs-messages-ui` (or `/couralabs-messages-ui on` /
`/couralabs-messages-ui off`).

```
▌ read src/index.ts
▌ 42 lines
❯ explain this codebase
```

The rule reuses the active theme's semantic status colors — `error` for a
failed call, `warning` while pending, and `success` on completion — pushed to a
bright pastel of the same hue so the thin rule stays legible while the messages
UI is active. Deriving it from the semantic colors (rather than the neutral
`tool*Bg` fills) keeps the rule green on success in every theme. Toggling affects
messages and tool calls rendered after the change; already rendered rows keep
their current look until the transcript is rebuilt (for example by resuming or
reloading the session).

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
│   │   ├── index.ts         # extension factory: command + event wiring
│   │   ├── field-editor.ts  # the boxed prompt editor component
│   │   ├── jokes.ts         # working-message phrases
│   │   └── spinner.ts       # working-indicator animation frames
│   ├── footer/
│   │   ├── index.ts         # extension factory: timers + event wiring
│   │   ├── render.ts        # pure footer rendering
│   │   ├── git.ts           # `git status --porcelain=v2` parser
│   │   └── history.ts       # turn/tool counters rebuilt from a session
│   └── messages/
│       ├── index.ts         # extension factory: renderer + transformer wiring
│       ├── renderers.ts     # tool-renderer wrapper
│       └── bordered-tool.ts # the left-rule tool component
├── shared/
│   ├── format.ts            # compact token formatting
│   ├── glyphs.ts            # shared UI symbols (`❯`, `▌`, …)
│   └── usage.ts             # cumulative token/cost accounting
├── themes/
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
