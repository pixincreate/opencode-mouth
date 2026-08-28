# Configuration

Pass options as a `[spec, options]` tuple in `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "plugin": [
    ["/absolute/path/to/mouth/dist/tui.js", { "sessionLimit": 200, "scope": "project", "range": "30d" }]
  ]
}
```

| Option         | Default     | Description                                                      |
| -------------- | ----------- | ---------------------------------------------------------------- |
| `sessionLimit` | `200`       | Number of most recent sessions to scan.                          |
| `scope`        | `"project"` | `"project"` scans the whole project, `"directory"` only the cwd. |
| `range`        | `"30d"`     | Initial time range: `24h`, `7d`, `30d`, `90d`, or `all`.         |

## Manual install

The installer manages the plugin entry for you, but you can also add it by hand.
Point the plugin list at the built `dist/tui.js`, or at `src/tui.tsx` directly; OpenCode compiles Solid JSX at load time for file plugins:

```json
{
  "plugin": ["/absolute/path/to/mouth/dist/tui.js"]
}
```

## Installer environment overrides

| Variable                   | Default                           |
| -------------------------- | --------------------------------- |
| `MOUTH_INSTALL_CONFIG`     | `~/.config/opencode/tui.jsonc`    |
| `MOUTH_INSTALL_STATE_DIR`  | `~/.local/share/opencode-mouth`   |
| `MOUTH_INSTALL_REPO_URL`   | this repository                   |
| `MOUTH_INSTALL_PLUGIN_SRC` | install the plugin file from a local path |
