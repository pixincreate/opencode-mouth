# opencode-mouth

Measure what comes out of your model's mouth (and yours).

## Introduction

Mouth adds a `/behavior` command to OpenCode.
It scans your sessions and shows a dashboard of profanity and friction: how often you yell at your model, swear at it, blame it — and what the model says back.

Ported from the Behavior feature in [oh-my-pi](https://github.com/can1357/oh-my-pi).

## Lore

oh-my-pi measures how often its users swear at their models and calls it Behavior.
OpenCode had no such mirror.
Now it does, and it points both ways.

## Installation

### From npm

Add the package to the `plugin` list in `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "plugin": ["opencode-mouth"]
}
```

Restart OpenCode and run `/behavior`.
OpenCode installs the package from npm on first start and caches it.

A bare package name resolves to the latest version once and stays on it.
To update, pin a version instead (for example `"opencode-mouth@1.2.0"`), or delete the cached copy under `~/.cache/opencode/packages/` and restart OpenCode.

### With the installer

```bash
curl -fsSL https://raw.githubusercontent.com/pixincreate/opencode-mouth/master/scripts/install.sh | bash
```

Working on the plugin itself? Use `--clone` to build from source, or see [docs/development.md](docs/development.md).

## Usage

Run `/behavior`, then drive it from the keyboard:

| Key         | What it does                             |
| ----------- | ---------------------------------------- |
| `tab`       | switch between **you** and **model**     |
| `1`-`5`     | time range: 24h, 7d, 30d, 90d, all       |
| `m`         | cycle the trend metric                   |
| `f`         | filter to one model                      |
| `g`         | toggle the **global** scope              |
| `r`         | rescan sessions                          |
| `j` / `k`   | scroll                                   |
| `esc` / `q` | close                                    |

By default the dashboard reads the current project.
`g` flips it to the **global** scope — every session across all projects, read straight from OpenCode's database, with a local cache keeping rescans fast.

Curious what the numbers mean or want to tune it? See [docs/how-it-works.md](docs/how-it-works.md) and [docs/configuration.md](docs/configuration.md).

## Uninstallation

```bash
curl -fsSL https://raw.githubusercontent.com/pixincreate/opencode-mouth/master/scripts/install.sh | bash -s -- --uninstall
```

## Credits

The metric engine and profanity word list come from [oh-my-pi](https://github.com/can1357/oh-my-pi), MIT licensed.
The word list deliberately excludes identity slurs and words that are technical in a coding corpus.

## License

[MIT](LICENSE)
