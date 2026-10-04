# opencode-mouth

Measure what comes out of your model's mouth (and yours).

## Introduction

Mouth adds `/behavior` and `/frustration` commands to OpenCode.
It scans your sessions and shows a dashboard of profanity and friction: how often you yell at your model, swear at it, blame it — and what the model says back.
The frustration dashboard adds a judge: a model reads your prompts and rates how annoyed they sound, with cached verdicts and a regex fallback.

Ported from the Behavior feature in [oh-my-pi](https://github.com/can1357/oh-my-pi).

## Lore

oh-my-pi measures how often its users swear at their models and calls it Behavior.
OpenCode had no such mirror.
Now it does, and it points both ways.

## Installation

### From npm

Use the same package on OpenCode v1 and v2.
On v1, add it to `plugin` in `~/.config/opencode/tui.jsonc`:

```jsonc
{
  "plugin": ["opencode-mouth"]
}
```

On v2, add it to `plugins` in `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["opencode-mouth"]
}
```

Restart OpenCode and run `/behavior` or `/frustration`.
OpenCode installs the package from npm on first start and caches it.

A bare package name resolves to the latest version once and stays on it.
To update, pin the package version you want and restart OpenCode.

### With the installer

```bash
curl -fsSL https://raw.githubusercontent.com/pixincreate/opencode-mouth/master/scripts/install.sh | bash
```

Working on the plugin itself? Use `--clone` to build from source, or see [docs/development.md](docs/development.md).
The installer detects `opencode --version`.
Pass `--opencode-version 1` or `--opencode-version 2` to select the host explicitly.

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
`g` switches to **global** scope and reads root sessions across projects from OpenCode's database.
V1 scans reuse cached metrics.
V2 scans reread message text because streaming updates can change existing rows.

### Frustration

`/frustration` classifies user messages as annoyed, at assistant, or angry.

A judge model reads each message and rates how annoyed it sounds.

Verdicts are cached by prose hash in Mouth's state directory; unjudged messages fall back to regex signals.

Run `/frustration`, then:

| Key | What it does |
| --- | --- |
| `u` | judge pending messages with the selected model |
| `m` | pick the judge model |
| `c` | cancel a running judge |
| `f` | hide model rows that are mostly regex-classified |
| `1`-`5` | time range: 24h, 7d, 30d, 90d, all |
| `g` | toggle the **global** scope |
| `r` | rescan sessions |
| `j` / `k` | scroll |
| `esc` / `q` | close |

Judging quotes the estimated cost before it runs.

Curious what the numbers mean or want to tune it? See [docs/how-it-works.md](docs/how-it-works.md) and [docs/configuration.md](docs/configuration.md).

## Uninstallation

```bash
curl -fsSL https://raw.githubusercontent.com/pixincreate/opencode-mouth/master/scripts/install.sh | bash -s -- --uninstall
```

## Credits

The metric engine, profanity word list, and frustration judge come from [oh-my-pi](https://github.com/can1357/oh-my-pi), MIT licensed.
The word list deliberately excludes identity slurs and words that are technical in a coding corpus.

## License

[MIT](LICENSE)
