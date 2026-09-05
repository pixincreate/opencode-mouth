# How it works

## Scanning

The plugin talks to the OpenCode server through the plugin SDK client:

- `session.list` fetches the most recent root sessions.
  Subagent sessions are excluded so synthetic prompts do not pollute your stats.
- `session.messages` fetches each session's messages with a small concurrency pool.
  A failing session is skipped and counted in the header, not fatal.

Scanning happens when you open the dashboard for the first time and when you press `r`.

Global scope reads the OpenCode database directly: message metadata is extracted per batch of sessions, and text parts are fetched by primary key after a cheap prefix check, so the huge JSON blobs most rows carry are never read whole.
Both scopes count the same messages: synthetic and ignored parts are skipped everywhere, and a session counts as root when it has no parent — the same rule the SDK applies.
Per-session metrics are cached under the mouth state directory keyed by each session's row counts, so rescans only re-read sessions that gained or lost messages; the first global scan pays the full cost once, every later one is milliseconds.
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

## Theme

All colors read reactively from the active OpenCode theme.
Switching themes restyles the dashboard live.
