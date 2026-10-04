# Development

## Setup

```bash
npm install
npm run check   # typecheck + build + tests
npm run shellcheck
npm run test:db # requires Bun; validates v1, v2, and mixed databases
```

Development install that points OpenCode at your local build:

```bash
scripts/install.sh --clone
```

Use `--opencode-version 1` or `--opencode-version 2` when host detection is unavailable.
Test both hosts before releasing changes to the adapters.

## Layout

- `src/metrics.ts`: behavior metric engine (oh-my-pi port)
- `src/judge.ts`: frustration judge prompt, parsing, and run engine (oh-my-pi port)
- `src/scan.ts`: session scanning and stats ingestion
- `src/stats-db.ts`: per-message stats and cached judge verdicts
- `src/ui.tsx`: shared dashboard helpers and components
- `src/frustration-tui.tsx`: the `/frustration` command and dashboard UI
- `src/db.ts`: direct SQLite reader for OpenCode's database (global scope)
- `src/cache.ts`: per-session row-count fingerprints for the global scan
- `src/tui.tsx`: the plugin entry point
- `src/host.ts`: v1 and v2 host adapters
- `src/messages.ts`: v2 transcript text and model attribution
- `build.mjs`: bundles `dist/tui.js`
- `test/`: behavioral tests run by `node --test`
- `scripts/`: installer and release helper
- `upstream.json`: pinned oh-my-pi commits this port is based on
- `.keywatch-baseline.json`: KeyWatch suppressions for known false
  positives (npm integrity hashes in the lockfile); refresh with
  `key-watch scan --staged --update-baseline`

## Build

`npm run build` compiles Solid JSX with the same Babel options OpenCode's runtime loader uses (`moduleName: "@opentui/solid"`, `generate: "universal"`) and bundles to `dist/tui.js`.
Imports of `@opentui/*` and `solid-js` stay external: when OpenCode loads the file from a path outside `node_modules`, its loader rewrites them to the host's own module instances, so the plugin shares the host's renderer and reactivity.

## Release

```bash
npm run release -- 1.0.1
```

The default branch is protected: changes land through squash-merged pull requests with the CI check required.
The release script bumps the version on a `release/vX.Y.Z` branch, opens a PR, merges it once checks pass, then tags the squash commit.
The tag triggers the release workflow, which attaches `tui.js` and the npm tarball to the GitHub release; that is what the installer downloads.

## CI

- `ci.yml`: ShellCheck, typecheck, build, and tests on pushes and PRs.
  The job name `ShellCheck, typecheck, build, and tests` is a required status check in the branch ruleset; do not rename it without updating the ruleset.
  A separate cross-platform job runs the suite on macOS and on the oldest supported Node.
- `release.yml`: builds and publishes release artifacts on tags
- `upstream-watch.yml`: weekly check of the oh-my-pi frustration/stats features.
  It compares the pinned SHAs in `upstream.json` against the latest upstream commits touching the tracked files and opens an issue with diff links when they drift.
  After porting upstream changes, update the pins.
- `dependabot.yml`: weekly npm and GitHub Actions updates
