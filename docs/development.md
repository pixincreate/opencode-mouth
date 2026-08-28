# Development

## Setup

```bash
npm install --legacy-peer-deps
npm run check   # typecheck + build + tests
```

`--legacy-peer-deps` is needed because `@opentui/keymap@0.4.5` pins `solid-js@1.9.12`.

Development install that points OpenCode at your local build:

```bash
scripts/install.sh --clone
```

## Layout

- `src/metrics.ts`: behavior metric engine (oh-my-pi port)
- `src/aggregate.ts`: pure aggregation with range and model filters
- `src/tui.tsx`: the `/behavior` command and dashboard UI
- `build.mjs`: bundles `dist/tui.js`
- `test/`: behavioral tests run by `node --test`
- `scripts/`: installer and release helper
- `upstream.json`: pinned oh-my-pi commits this port is based on

## Build

`npm run build` compiles Solid JSX with the same Babel options OpenCode's runtime loader uses (`moduleName: "@opentui/solid"`, `generate: "universal"`) and bundles to `dist/tui.js`.
Imports of `@opentui/*` and `solid-js` stay external: when OpenCode loads the file from a path outside `node_modules`, its loader rewrites them to the host's own module instances, so the plugin shares the host's renderer and reactivity.

## Release

```bash
npm run release -- 0.1.0
```

That updates the package version, runs checks, commits the bump, creates `v0.1.0`, and pushes the branch and tag.
The release workflow attaches `tui.js` and the npm tarball to the GitHub release, which is what the installer downloads.

## CI

- `ci.yml`: ShellCheck, typecheck, build, and tests on pushes and PRs
- `release.yml`: builds and publishes release artifacts on tags
- `upstream-watch.yml`: weekly check of the oh-my-pi behavior feature.
  It compares the pinned SHAs in `upstream.json` against the latest upstream commits touching the tracked files and opens an issue with diff links when they drift.
  After porting upstream changes, update the pins.
- `dependabot.yml`: weekly npm and GitHub Actions updates
