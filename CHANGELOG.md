# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.8.0] - 2026-11-04

### Fixed

- pi 1.5.0 compatibility — submode-exit parameter typing under the new pi-ai enum schema.
- Extension loading without a local pi-tui install (vendored `wordWrapLine`/`decodePrintableKey` replace deep dist imports).
- Crash when naming a session that was switched/reloaded mid-title-generation (best-effort write, no more fatal unhandled rejection).

### Added

- Thinking markdown transformers now receive the pi 1.5.0 `messageId`/`timestamp` context fields.
- This changelog.
