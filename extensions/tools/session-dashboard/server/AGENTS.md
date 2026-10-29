# session-dashboard server

Server-side conventions for the web app under `server/`. The extension
that orchestrates this server lives at the project root — see the root
`AGENTS.md` for that side.

## Scope

- `server.ts` — single-file Node HTTP server, run with `tsx`.
- `src/` — React + Vite SPA.
- `tests/` — Vitest. Server tests in `tests/server/`, client tests in
  `tests/client/`. Client tests use `// @vitest-environment happy-dom` at
  the top of the file.
- `fixtures/` — sample session JSONLs for tests.
- `package.json`, `tsconfig.json`, `tsconfig.server.json`,
  `tsconfig.client.json`, `vite.config.ts`, `vitest.config.ts` — dev
  tooling.

## Conventions

- **Server contract**: `walkActiveBranch` returns leaf-first (newest at
  index 0). Don't change this without coordinating with the frontend.
- **Display order**: oldest at the top, newest at the bottom. When
  iterating the branch for rendering, iterate
  `[...branch.keys()].reverse()` (or compute `branch.length - 1 - i`)
  and pass the ORIGINAL index into `<Message>` so its
  `entries[index]` look-up and its `entries[index + 1]` /
  `entries[index - 1]` look-aheads continue to operate on the
  leaf-first layout.
- **SSE append**: new entries go to `branch[0]` (prepend). The frontend
  prepends via `setBranch((prev) => [obj, ...prev])`.
- **Tests**: Vitest. Test helpers live in `tests/helpers/` (server) and
  `tests/client/helpers/` (client).
- **Styling**: single CSS file `src/styles.css`. Use CSS variables
  defined in `:root`. No UI library. Theming is CSS-only — toggle a
  `data-theme` attribute on `<html>` and override variables in
  `:root[data-theme="light"]`; never branch on theme in component code.
  The `.thinking-block` style (used by AssistantMessage when
  `showThinking` is on) lives in this file and references CSS variables
  from `:root`.
- **Type sharing**: `src/types.ts` mirrors the wire types in `server.ts`
  line ~30. Field names match exactly. When adding a new entry type,
  update both. `SessionStats` (the aggregate stats shipped on the detail
  endpoint and inside every SSE `entry` envelope) is shared the same
  way — mirror it in both `server.ts` and `src/types.ts`.
- **Duplicated libs**: `lib/stats.ts` and `src/lib/stats.ts` are
  duplicated **identical** copies of `computeSessionStats` (server and
  client run in separate runtimes and don't share an import graph). Keep
  them byte-for-byte in sync when editing; parallel test suites in
  `tests/server/stats.test.ts` and `tests/client/stats.test.ts` assert
  identical behavior on the same fixtures.
- **Markdown**: assistant + user message text is rendered through
  `<Markdown>` (`src/components/Markdown.tsx`). All other entry types
  (tool result content, bash output, compaction, branch summary, custom
  message, tool call args, **and thinking blocks**) stay as `<pre>` —
  markdown would mangle structured data. The dispatcher in
  `src/components/Message.tsx` is unchanged. XSS relies on
  `react-markdown` escaping HTML by default; do NOT add `rehype-raw`.
- **Bash filter gates both `bashExecution`-role messages AND
  `toolResult` messages with `toolName === "bash"`**: bash toolResults
  are overwhelmingly how bash calls are stored in real data (3,963
  toolResults vs. 81 bashExecution-role in the probed session corpus).
  The `toolResult` filter EXCLUDES bash toolResults — bash has its own
  pill. User-facing semantics: the "tool" pill hides all toolResults
  EXCEPT bash; the "bash" pill hides bash (both kinds). With both off,
  no toolResults render.
- **Thinking blocks** (`type === "thinking"` content blocks inside
  assistant messages) are rendered as collapsible
  `<details class="thinking-block">` when the `showThinking` filter is
  on; otherwise silently dropped (default off). The defensive
  `typeof b.thinking === "string"` guard pattern from `blocksToText`
  (`AssistantMessage.tsx:8-15`) is reused. Thinking content is rendered
  via `<pre>`, NOT markdown, to avoid mangling structured reasoning.
- **Filter-aware dispatcher**: `<Message>` accepts an optional
  `visibleIndices?: ReadonlySet<number>` prop. When provided, the
  dispatcher uses it to: (1) skip absorbing a toolResult whose preceding
  assistant is filtered out (renders it as orphan instead of null), (2)
  skip hidden toolResults in the assistant's look-ahead (visible
  siblings still group), (3) skip hidden toolResults in the
  orphan-toolResult look-ahead. When `undefined`, all entries are
  treated as visible (preserves single-entry test behavior).
  `SessionView` computes the set via `useMemo` from `[branch, filters]`.

## Common tasks

- **Add a new entry type**:
  1. Add it to the `SessionEntry` union in `server.ts` (line ~30).
  2. Add the same shape to `src/types.ts`.
  3. Add a renderer branch to the dispatcher in
     `src/components/Message.tsx`.
  4. Add a server test fixture if it changes walking behavior.
- **Add a new API endpoint**: add the handler inside the `createHandler`
  factory in `server.ts`. Make sure the SPA fallback (any non-`/api/*`
  path serves `dist/index.html` in production) still works.
- **Change display order or chat scrolling**: edit
  `src/views/SessionView.tsx`. Keep the SSE prepend and the reverse-render
  paired — if you change one, change the other.
- **Style changes**: edit `src/styles.css`. Use CSS variables from
  `:root`.

## Run commands

Run from the project root with the `npm` script (preferred), or from
`server/` directly:

- `npm run dev` — both the backend server (53510) and the Vite dev server
  (53509) concurrently.
- `npm run dev:server` — backend only.
- `npm run dev:client` — Vite only.
- `npm run build` — `tsc -b && vite build` → `dist/` (relative to cwd).
- `npm run preview` — preview the built bundle.
- `npm test` — Vitest, all tests.
- `npm test:watch` — Vitest watch mode.
- `npm run typecheck` — `tsc -b` over both server and client tsconfigs.

## Gotchas

- **macOS `fs.watch` is unreliable.** A polling fallback runs every
  500ms regardless of whether `fs.watch` events fire
  (belt-and-suspenders). Don't remove it.
- **`walkActiveBranch` post-processes compactions.** After walking
  leaf → root, it drops everything older than any compaction encountered
  on the path. The compaction represents summarized history, so
  ancestors of a compaction are not on the active branch.
- **`useScrollControl` returns a memoized object.** Don't destructure
  its return value in a way that triggers re-renders — downstream
  effects that depend on the API object reference will loop.
- **Don't use `flex-direction: column-reverse` on the chat container.**
  It interacts weirdly with auto-scroll and event delegation. Reverse
  the data instead (see Display convention above).
- **ToolResult grouping in `Message.tsx`**: the dispatcher groups an
  assistant with adjacent toolResults. In real Pi data, toolResults are
  newer than the assistant that triggered them (the toolResult's
  `parentId` is the assistant's `id`), so in the leaf-first array the
  toolResult sits at a HIGHER index than the assistant that produced it.
  The dispatcher therefore: (1) uses `entries[index + 1..]` to collect
  toolResults that follow an assistant (in the leaf-first walk toward
  older entries), and (2) uses `entries[index - 1]` to detect a
  "preceding assistant" for a toolResult — which is a DIFFERENT turn's
  assistant (the next-newer turn), not the producer. The grouping is
  therefore visually correct under the alternating pattern but
  semantically groups the wrong toolResult with each assistant. A proper
  fix would walk the `parentId` chain instead of using array adjacency
  — out of scope. Don't flip these directions without thinking — the
  leaf-first contract is what the rest of the app relies on. The
  dispatcher respects the optional `visibleIndices` prop to skip hidden
  entries in both the absorb check and the look-aheads.
- **SSE entries must be prepended, not appended.** New entries from the
  stream are the newest by definition; appending them to `branch` would
  put them at the visual TOP (the "upside down chat" bug). If you're
  debugging scroll behavior, check the SSE handler first.
- **`branch.length > 0` is used as a one-shot effect key in
  SessionView.** It's intentionally not the array itself — initial
  auto-scroll fires once after the first paint, not on every update.
