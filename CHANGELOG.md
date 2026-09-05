# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.1.0] - 2026-09-05

### Added

- Global scope: press `g` in the dashboard to toggle between the current
  project and every session across all projects; global reads OpenCode's
  SQLite database directly via `bun:sqlite` (the embedded Bun runtime does
  not implement `node:sqlite`)
- `scope` configuration option (`project`, `directory`, or `global`) to
  pick the starting scope
- Per-session metrics cache keyed by session row counts, so rescans only
  re-read sessions that changed; the first global scan pays once, later
  ones are near-instant
- Batched scanning that yields between batches so the progress bar stays
  live while scanning
- By-model table caps at 12 rows with an overflow hint; the long tail
  stays reachable through the model filter

### Fixed

- Scrollbar thumb now reflects the real scroll distance: opentui clamped
  it to half the track regardless of range, and panel backgrounds hid it
  outside the gap rows
- Dashboard header keeps its spacing when the by-model table grows long
- Model table no longer overflows into the scrollbar column

### Changed

- Development dependencies updated: @opentui packages to 0.5.10 in
  lockstep, @opencode-ai/plugin to 1.18.25, @types/node to 26.4.1;
  Dependabot no longer proposes @opentui bumps (they are host-provided
  and bumped manually in lockstep)

## [1.0.1] - 2026-08-28

### Added

- Contract tests for the built bundle: valid ESM, imports restricted to
  host-provided modules, no dynamic imports
- End-to-end installer tests covering fresh install, config preservation,
  reinstall idempotency, and uninstall
- Cross-platform CI job running the suite on macOS and on the oldest
  supported Node version

### Changed

- Release script now works with the protected default branch: it opens a
  release PR, squash-merges it once checks pass, and tags the squash commit
- Development dependencies updated: @opentui packages to 0.5.8 in lockstep,
  solid-js to 1.9.15, TypeScript to 7

## [1.0.0] - 2026-08-28

### Added

- `/behavior` command and full-screen TUI dashboard for OpenCode
- Behavior metric engine ported from oh-my-pi (`packages/stats/src/user-metrics.ts`, MIT):
  yelling (CAPS), profanity with a curated word list, anguish, negation, repetition, and blame
- Assistant-side analyzer that scores profanity and yelling in model replies
  without the user-tuned prose-length guard
- Profanity counts in user messages of any length. This deviates from
  oh-my-pi, which zeroes all signals on prompts with three or more prose
  lines; Mouth keeps that guard only for the emotional signals
- Prose-only scoring: code fences, inline code, XML tags, URLs, quoted lines,
  and file mentions never count toward signals
- Two dashboard views toggled with `tab`: **you** (your prompts, OMP parity)
  and **model** (the model's replies, dirty vocabulary, favorite word)
- Time range filter (`1`-`5`: 24h, 7d, 30d, 90d, all) applied to every panel
- Model filter (`f`) backed by the native OpenCode select dialog
- Trend chart with metric cycling (`m`) and automatic day-bucketing so wide
  ranges stay within 15 bars
- Summary cards, per-model rate table, signal breakdown panel, and
  top-offenders word list
- Per-word profanity tallies aggregated across the scanned range
- Session scanning through the OpenCode SDK with progress display,
  concurrency limit, per-session failure tolerance, and subagent exclusion
- Live theme support: all colors read reactively from the active OpenCode theme
- Build step (`npm run build`) that compiles Solid JSX with the same Babel
  options OpenCode's runtime loader uses and bundles to `dist/tui.js`
- One-line installer with release, clone, and uninstall modes that manages a
  marked plugin entry in `~/.config/opencode/tui.jsonc`
- Release helper script for version bumps, checks, tagging, and pushing
- CI workflow covering ShellCheck, typecheck, build, and tests
- Release workflow that attaches `tui.js` and the npm tarball to GitHub releases
- Upstream watch workflow that opens an issue when oh-my-pi changes its
  behavior feature, pinned in `upstream.json`
- Dependabot configuration for npm and GitHub Actions updates
- Behavioral test suite for the metric engine and aggregation run by `node --test`
