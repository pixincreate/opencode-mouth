# How it works

Mouth uses the host's SQLite implementation.
Bun hosts use `bun:sqlite`; Node hosts use `node:sqlite`.
The Node TUI host requires Node 26.1 or later for OpenTUI's `node:ffi` support.

## Scanning

The plugin talks to the OpenCode server through the plugin SDK client:

- `session.list` fetches the most recent root sessions.
  Subagent sessions are excluded so synthetic prompts do not pollute your stats.
- `session.messages` on v1 and paginated `message.list` on v2 fetch each session's messages with a small concurrency pool.
  A failing session is skipped and counted in the header, not fatal.

Scanning happens when you open the dashboard for the first time and when you press `r`.

Global scope reads the OpenCode database directly.
V1 uses `session`, `message`, and text `part` rows.
V2 uses `session_v2` and `session_message` in transcript sequence order.
If both schemas contain a session ID, the v2 session takes precedence.
Legacy-only sessions remain readable during partial migration.
Both scopes skip synthetic content and count only root sessions.
V2 scoring includes user text and top-level assistant text, not reasoning or nested tool output.
V1 metrics use a database-specific cache keyed by row counts.
That cache does not detect edits that leave row counts unchanged; delete the cache to force a fresh v1 global scan.
V2 sessions bypass the cache so existing-row text updates remain visible.
While the scan runs, a live progress bar keeps the dashboard responsive: the scan yields between batches so every batch paints immediately.

## Scoring

Each text message is scored by the metric engine in `src/metrics.ts`, a port of oh-my-pi's `user-metrics.ts`.

Structured content is stripped before scoring: code fences, inline code, XML/HTML tags, URLs, file mentions, dotted tokens, quoted lines, image markers, and ANSI escapes never count.
Signals are counted on the remaining prose with word-boundary, case-insensitive regexes.

Signals for your messages:

| Signal     | What it catches                                              |
| ---------- | ------------------------------------------------------------ |
| Yelling    | sentences that are mostly CAPS across multiple words          |
| Profanity  | the curated word list, including censored variants (`fck`)    |
| Anguish    | `!!!`, `noooo`, `ugh`, `argh`, `dude`, `:(`                   |
| Negation   | message-opening `no` / `nope` / `wrong`, `makes no sense`     |
| Repetition | `like i said`, `i already told you`, `still doesnt`           |
| Blame      | `you didn't`, `why did you`, sentence-leading `stop X-ing`    |

Friction is negation + repetition + blame.

Signals for model replies: profanity and yelling only.
The other signals are tuned for human tantrums and stay zero.

## The prose-length guard

Upstream oh-my-pi zeroes every signal when a user message has three or more prose lines, on the theory that formatted prompts are deliberate, not emotional.

Mouth keeps that guard for the emotional signals (yelling, anguish, negation, repetition, blame) but deliberately deviates for profanity: a swear in a long prompt is still a swear, so profanity counts in messages of any length.
Model replies never had the guard.

## Frustration and the judge

The `/frustration` dashboard answers a narrower question than the signal
breakdown: how often do your messages sound annoyed, and is the annoyance
aimed at the assistant? It ports oh-my-pi's Frustration feature.

Each user message with prose is classified once:

- **Regex fallback** — annoyed when any signal fires, at assistant when
  negation, repetition, or blame fires, angry when it is at the assistant
  and contains profanity or yelling.
- **Judge verdict** — when a cached verdict exists, annoyed means
  P(level 2) + P(level 3) ≥ 0.5, at assistant additionally requires the
  judge to name the assistant as the target, and angry requires
  P(level 3) ≥ 0.5.

Annoyed ⊇ at assistant ⊇ angry. Rows where fewer than half the messages
have a verdict are flagged as mostly regex.

### Judging

Press `u` (or `m` to pick a different model) to judge every unjudged prose
text in the range. Mouth quotes the estimated cost first, using the model's
input and output prices. The run:

- sends each unique prose text once, capped at 4000 characters;
- runs 32 requests concurrently with up to 3 attempts per text;
- stops early after 25 failures when nothing has succeeded;
- stores each verdict by prose hash, so later runs skip judged text;
- can be cancelled with `c`.

Verdicts and the stripped prose they cover live in Mouth's own state
directory (`judge/verdicts.db`), next to the metrics cache. Nothing leaves
your machine except the judge requests themselves, which go to the model
you pick through OpenCode.

On OpenCode v1 the judge runs in a temporary session with tools disabled
and JSON-schema output. On OpenCode v2 it uses the host's generate API.

## Aggregation and filters

Scoring produces one metric record per message: role, provider/model, timestamp, and counts.
Every dashboard panel derives from those records in memory:

- the time range filter keeps records newer than the cutoff
- the model filter keeps one provider/model
- the trend chart groups days into buckets so any range fits in 15 bars

Changing the view, range, metric, or model filter never rescans.
The scope toggle (`g`) is the exception: project, directory, and global read different session sets, so switching scope rescans from that source.

## Attribution

Your messages are attributed to the model you were talking to, so the "you" view answers "which model makes me swear the most".
Model replies are attributed to the model that wrote them.
V2 user attribution follows recorded model switches.
When historical selection is unavailable, the reader falls back to the session model.
Migrated transcripts can therefore lack exact historical user-model attribution.

## Theme

All colors read reactively from the active OpenCode theme.
Switching themes restyles the dashboard live.
