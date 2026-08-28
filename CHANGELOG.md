# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
