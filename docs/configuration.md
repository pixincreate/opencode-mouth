# Configuration

On OpenCode v1, pass options as a `[spec, options]` tuple in `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "plugin": [
    ["/absolute/path/to/mouth/dist/tui.js", { "sessionLimit": 200, "scope": "project", "range": "30d" }]
  ]
}
```

On OpenCode v2, use a plugin object in `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    { "package": "opencode-mouth", "options": { "sessionLimit": 200, "scope": "project", "range": "30d" } }
  ]
}
```

| Option         | Default     | Description                                                      |
| -------------- | ----------- | ---------------------------------------------------------------- |
| `sessionLimit` | `200`       | Number of most recent sessions to scan.                          |
| `scope`        | `"project"` | `"project"` scans the whole project, `"directory"` only the cwd, `"global"` reads all sessions from the OpenCode database. |
| `range`        | `"30d"`     | Initial time range: `24h`, `7d`, `30d`, `90d`, or `all`.         |

The config value is only the starting scope: pressing `g` in the dashboard toggles between the global scope and the scope you started in, rescanning each time.

V1 global scans cache per-session metrics under `global-cache/` in the mouth state directory (`MOUTH_INSTALL_STATE_DIR`, default `~/.local/share/opencode-mouth`).
Delete that directory to discard cached metrics.
V2 sessions bypass the cache so rescans include text updates that do not add rows.

## Manual install

The installer manages the plugin entry for you, but you can also add it by hand.
On v1, point the plugin list at the built `dist/tui.js`:

```json
{
  "plugin": ["/absolute/path/to/mouth/dist/tui.js"]
}
```

On v2, point `plugins` at `/absolute/path/to/mouth/dist`.
V2 loads local directories containing `tui.js`, not standalone files.
Set `OPENCODE_DB` if your global session database uses a non-default path.
Otherwise, the reader uses `$XDG_DATA_HOME/opencode/opencode.db`, or `~/.local/share/opencode/opencode.db` when `XDG_DATA_HOME` is unset.

## Installer environment overrides

| Variable                   | Default                           |
| -------------------------- | --------------------------------- |
| `MOUTH_INSTALL_CONFIG`     | `tui.jsonc` on v1; `cli.json` on v2, under `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` |
| `MOUTH_INSTALL_STATE_DIR`  | `~/.local/share/opencode-mouth`   |
| `MOUTH_INSTALL_REPO_URL`   | this repository                   |
| `MOUTH_INSTALL_PLUGIN_SRC` | install the plugin file from a local path |
