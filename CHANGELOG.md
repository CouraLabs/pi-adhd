# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.9.0] - 2026-11-14

### Added

- Response-style rules (answer first, stepped structure, full technical density, one strategic next step) appended to the system prompt for every agent: as the only append on Claude Agent, and as a `<response_style>` section in pi modes.
- Claude Agent: pi thinking levels map to SDK effort and apply live; models advertise their supported levels.
- Claude Agent: `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) is deep-merged over pi-adhd's default SDK settings.

### Changed

- Footer: context and plan-limit gauges removed (icon, percent and value remain); Claude Agent hides the provider prefix and USD cost.
- Editor: cwd and git info moved to the prompt box's top border.
- Claude Agent no longer appends submode instructions or submode-change reminders; submode tool limits still apply.
- Claude Agent SDK updated to 0.3.325 and pi packages to 1.5.2.

### Fixed

- Claude Agent cost counted the SDK's running session total on every turn; each turn now gets only its own share.
- Claude Agent context usage summed input across API calls; it now reports the last call.
- Claude Agent dropped replies that Claude Code delivered without streaming.
- Claude Agent errors now explain 5xx/529 failures, subscription limits with reset time, billing, and login.
- Shell `MCP_TOOL_TIMEOUT`, `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SIMPLE` no longer leak into the Claude SDK process.
- Session title generation is cancelled on shutdown instead of writing to a stale session.

## [0.8.0] - 2026-11-04

### Fixed

- pi 1.5.0 compatibility — submode-exit parameter typing under the new pi-ai enum schema.
- Extension loading without a local pi-tui install (vendored `wordWrapLine`/`decodePrintableKey` replace deep dist imports).
- Crash when naming a session that was switched/reloaded mid-title-generation (best-effort write, no more fatal unhandled rejection).

### Added

- Thinking markdown transformers now receive the pi 1.5.0 `messageId`/`timestamp` context fields.
- This changelog.
