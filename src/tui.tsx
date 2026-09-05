/** @jsxImportSource @opentui/solid */
/**
 * OpenCode Mouth: behavior dashboard TUI plugin.
 *
 * Registers the `/behavior` command. It opens a full-screen dashboard that
 * scans the project's sessions and measures profanity and friction signals
 * in both your prompts and the model's replies.
 */
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiRouteCurrent,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  buildRoleStats,
  dayKey,
  frictionOf,
  hitsOf,
  modelsOf,
  toRecord,
  type DayTotals,
  type MetricRecord,
  type ModelTotals,
  type Role,
  type MessageSample,
  type RoleStats,
  type Totals,
} from "./aggregate.ts";
import { queryGlobalSessions, queryMessageMetas, queryTextParts } from "./db.ts";
import type { MessageMeta, SessionFingerprint } from "./db.ts";
import { loadCachedSession, pruneSessionCache, saveCachedSessions, type CacheEntry } from "./cache.ts";

const ROUTE = "mouth-behavior";
const MODE = "mouth.behavior";
const DEFAULT_SESSION_LIMIT = 200;
/** Sentinel attribution for messages whose model could not be determined. */
const UNKNOWN_MODEL = "unknown";
const MODEL_FILTER_KEY = "f";
/** Cache-check loop granularity: sessions per yield while matching fingerprints. */
const CACHE_CHECK_CHUNK = 50;
/** Body column width: terminal minus root padding and the scrollbar gutter. */
const BODY_INSET = 9;
/** Panel borders + inner padding, on top of BODY_INSET, for text width math. */
const PANEL_CHROME = 4;
/** Scrollbar thumb fix: apply quickly, then again once layout settles. */
const THUMB_FIX_DELAY_MS = 100;
const THUMB_FIX_SETTLE_MS = 600;
const FETCH_CONCURRENCY = 6;
const BAR_WIDTH = 22;
const MAX_CHART_BARS = 15;

type Palette = () => TuiThemeCurrent;

type ColorToken = "primary" | "accent" | "error" | "warning" | "info" | "success" | "text" | "textMuted";

// --- options ----------------------------------------------------------------

const RANGES = [
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "90d", label: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "all", ms: undefined },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const METRICS = [
  { key: "total", label: "All signals", roles: ["user", "assistant"] },
  { key: "yelling", label: "Yelling (CAPS)", roles: ["user", "assistant"] },
  { key: "profanity", label: "Profanity", roles: ["user", "assistant"] },
  { key: "anguish", label: "Anguish (!!!, nooo, ugh)", roles: ["user"] },
  { key: "negation", label: "Negation (no/nope/wrong)", roles: ["user"] },
  { key: "repetition", label: "Repetition (i meant, still doesnt)", roles: ["user"] },
  { key: "blame", label: "Blame (you didnt, stop X-ing)", roles: ["user"] },
  { key: "friction", label: "Friction (neg + rep + blame)", roles: ["user"] },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

const metricValue = (totals: Totals, metric: MetricKey): number => {
  if (metric === "total") return hitsOf(totals);
  if (metric === "friction") return frictionOf(totals);
  return totals[metric];
};

const metricsForRole = (role: Role) => METRICS.filter((m) => (m.roles as readonly Role[]).includes(role));

interface MouthOptions {
  /** Number of most recent sessions to scan. */
  sessionLimit: number;
  /** Session scope: the whole project, only the current directory, or all sessions globally. */
  scope: "project" | "directory" | "global";
  /** Initial time range filter. */
  range: RangeKey;
}

type Scope = MouthOptions["scope"];

const parseOptions = (options: unknown): MouthOptions => {
  const record = options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const int = (value: unknown, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  const range = RANGES.find((r) => r.key === record.range)?.key ?? "30d";
  return {
    sessionLimit: int(record.sessionLimit, DEFAULT_SESSION_LIMIT),
    scope: record.scope === "directory" || record.scope === "global" ? record.scope : "project",
    range,
  };
};

// --- formatting -------------------------------------------------------------

const fmtInt = (n: number): string => n.toLocaleString("en-US");

const fmtRate = (hits: number, messages: number): string => {
  if (messages <= 0) return "-";
  const pct = (hits / messages) * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
};

const perHundred = (hits: number, messages: number): string | undefined => {
  if (messages <= 0 || hits === 0) return undefined;
  return `${((hits / messages) * 100).toFixed(1)} per 100 msgs`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayLabel = (day: string): string => {
  const [, month, date] = day.split("-");
  const index = Number(month) - 1;
  return `${MONTHS[index] ?? month} ${Number(date)}`;
};

const clockLabel = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const modelLabel = (model: ModelTotals): string => `${model.providerID}/${model.modelID}`;

const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

const bar = (ratio: number, width: number): { fill: string; rest: string } => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const cells = clamped > 0 ? Math.max(1, Math.round(clamped * width)) : 0;
  return { fill: "█".repeat(cells), rest: "░".repeat(width - cells) };
};

// --- data loading -----------------------------------------------------------

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ScanResult {
  records: MetricRecord[];
  sessions: number;
  failures: number;
  loadedAt: number;
}

/**
 * Normalize a message from any source into a scoreable sample. User messages
 * nest the model (SDK: info.model, DB: $.model) while assistant messages carry
 * top-level fields, so callers resolve per source and pass nullable values.
 */
function toSample(
  role: string,
  providerID: string | null | undefined,
  modelID: string | null | undefined,
  created: number,
  text: string,
): MessageSample {
  const isUser = role === "user";
  return {
    role: isUser ? "user" : "assistant",
    providerID: providerID ?? UNKNOWN_MODEL,
    modelID: modelID ?? UNKNOWN_MODEL,
    created,
    text,
  };
}

async function scan(
  api: TuiPluginApi,
  opts: MouthOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult> {
  // Global scope: read directly from the SQLite database
  if (opts.scope === "global") {
    return scanGlobal(opts, onProgress);
  }

  // Project/directory scope: use the SDK
  const list = await api.client.session.list(
    {
      limit: opts.sessionLimit,
      roots: true,
      ...(opts.scope === "project" ? { scope: "project" as const } : {}),
    },
    { throwOnError: true },
  );
  const sessions = list.data ?? [];
  onProgress(0, sessions.length);

  const records: MetricRecord[] = [];
  let done = 0;
  let failures = 0;

  await mapPool(sessions, FETCH_CONCURRENCY, async (session) => {
    try {
      const response = await api.client.session.messages({ sessionID: session.id }, { throwOnError: true });
      for (const message of response.data ?? []) {
        const info = message.info;
        const text = message.parts
          .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n");
        if (!text.trim()) continue;
        const isUser = info.role === "user";
        records.push(
          toRecord(
            toSample(
              info.role,
              isUser ? info.model?.providerID : info.providerID,
              isUser ? info.model?.modelID : info.modelID,
              info.time.created,
              text,
            ),
          ),
        );
      }
    } catch {
      failures += 1;
    }
    done += 1;
    onProgress(done, sessions.length);
  });

  return { records, sessions: sessions.length, failures, loadedAt: Date.now() };
}

/**
 * Sessions processed between progress paints. Small enough that the TUI
 * repaints the progress bar between batches, large enough to amortize the queries.
 */
const SCAN_BATCH = 25;

/** Let the TUI render before the next synchronous batch of work. */
const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Scan all sessions from the SQLite database directly.
 * Used when scope is "global".
 *
 * Each session's metrics are cached under its row-count fingerprint, so
 * unchanged sessions are neither re-read nor re-scored; only the rest are
 * fetched in batches (see db.ts for how the queries keep the huge JSON blobs
 * of message/part rows out of the hot path).
 */
async function scanGlobal(
  opts: MouthOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult> {
  await yieldToUI();
  const sessionList = queryGlobalSessions(opts.sessionLimit);
  onProgress(0, sessionList.length);

  const records: MetricRecord[] = [];
  const toSave: CacheEntry[] = [];
  const stale: Array<{ id: string; fp: SessionFingerprint }> = [];
  for (let start = 0; start < sessionList.length; start += CACHE_CHECK_CHUNK) {
    if (start > 0) await yieldToUI();
    for (const session of sessionList.slice(start, start + 50)) {
      const fp = { messages: session.message_count, parts: session.part_count };
      const cached = loadCachedSession(session.id, fp);
      if (cached) records.push(...cached);
      else stale.push({ id: session.id, fp });
    }
  }
  const cachedCount = sessionList.length - stale.length;
  onProgress(cachedCount, sessionList.length);

  let failures = 0;
  for (let start = 0; start < stale.length; start += SCAN_BATCH) {
    await yieldToUI();
    const batch = stale.slice(start, start + SCAN_BATCH);
    try {
      const batchIds = batch.map((entry) => entry.id);
      const metas = queryMessageMetas(batchIds);
      const texts = queryTextParts(batchIds);
      const metasBySession = new Map<string, MessageMeta[]>();
      for (const meta of metas) {
        const list = metasBySession.get(meta.sessionId);
        if (list) list.push(meta);
        else metasBySession.set(meta.sessionId, [meta]);
      }
      for (const { id, fp } of batch) {
        try {
          const sessionRecords: MetricRecord[] = [];
          for (const meta of metasBySession.get(id) ?? []) {
            const text = texts.get(meta.id)?.join("\n").trim();
            if (!text) continue;
            sessionRecords.push(toRecord(toSample(meta.role, meta.providerID, meta.modelID, meta.created, text)));
          }
          toSave.push({ id, fp, records: sessionRecords });
          records.push(...sessionRecords);
        } catch {
          failures += 1;
        }
      }
    } catch {
      failures += batch.length;
    }
    onProgress(cachedCount + Math.min(start + SCAN_BATCH, stale.length), sessionList.length);
  }
  saveCachedSessions(toSave);
  pruneSessionCache(sessionList.map((session) => session.id));

  return { records, sessions: sessionList.length, failures, loadedAt: Date.now() };
}

type LoadState =
  | { status: "idle" }
  | { status: "loading"; done: number; total: number }
  | ({ status: "ready" } & ScanResult)
  | { status: "error"; message: string };

// --- trend chart buckets ----------------------------------------------------

interface ChartBucket {
  label: string;
  totals: Totals;
}

/**
 * Bucket per-day totals into at most `maxBars` bars spanning the filtered
 * range. 24h/7d ranges get one bar per day; wider ranges group days.
 */
export function buildChartBuckets(
  byDay: DayTotals[],
  sinceMs: number | undefined,
  now: number,
  maxBars = MAX_CHART_BARS,
): { buckets: ChartBucket[]; daysPerBucket: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  let startDay: string;
  if (sinceMs !== undefined) {
    startDay = dayKey(sinceMs);
  } else if (byDay.length > 0) {
    startDay = byDay[0].day;
  } else {
    startDay = dayKey(now);
  }
  const start = new Date(`${startDay}T00:00:00`).getTime();
  const spanDays = Math.max(1, Math.round((now - start) / dayMs) + 1);
  const daysPerBucket = Math.max(1, Math.ceil(spanDays / maxBars));
  const bucketCount = Math.ceil(spanDays / daysPerBucket);

  const byKey = new Map(byDay.map((d) => [d.day, d]));
  const buckets: ChartBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = start + i * daysPerBucket * dayMs;
    const totals: Totals = {
      messages: 0,
      chars: 0,
      words: 0,
      yelling: 0,
      profanity: 0,
      anguish: 0,
      negation: 0,
      repetition: 0,
      blame: 0,
    };
    for (let d = 0; d < daysPerBucket; d++) {
      const day = byKey.get(dayKey(bucketStart + d * dayMs));
      if (!day) continue;
      totals.messages += day.messages;
      totals.chars += day.chars;
      totals.words += day.words;
      totals.yelling += day.yelling;
      totals.profanity += day.profanity;
      totals.anguish += day.anguish;
      totals.negation += day.negation;
      totals.repetition += day.repetition;
      totals.blame += day.blame;
    }
    buckets.push({ label: dayLabel(dayKey(bucketStart)), totals });
  }
  return { buckets, daysPerBucket };
}

// --- dashboard components ---------------------------------------------------

interface Card {
  label: string;
  value: string;
  sub?: string;
  color?: ColorToken;
}

const roleCards = (role: Role, stats: RoleStats): Card[] => {
  const t = stats.totals;
  const worst = [...stats.byModel].sort((a, b) => hitsOf(b) - hitsOf(a))[0];
  const cards: Card[] = [
    { label: role === "user" ? "Your messages" : "Model messages", value: fmtInt(t.messages), sub: "in range" },
    { label: "Yelling (CAPS)", value: fmtInt(t.yelling), sub: perHundred(t.yelling, t.messages), color: "warning" },
    { label: "Profanity hits", value: fmtInt(t.profanity), sub: perHundred(t.profanity, t.messages), color: "error" },
  ];
  if (role === "user") {
    cards.push(
      { label: "Anguish signals", value: fmtInt(t.anguish), sub: perHundred(t.anguish, t.messages), color: "info" },
      {
        label: "Friction signals",
        value: fmtInt(frictionOf(t)),
        sub: perHundred(frictionOf(t), t.messages),
        color: "accent",
      },
    );
  } else {
    cards.push(
      { label: "Dirty vocabulary", value: fmtInt(stats.words.length), sub: "distinct words", color: "info" },
      {
        label: "Favorite word",
        value: stats.words[0]?.word ?? "—",
        sub: stats.words[0] ? `${fmtInt(stats.words[0].count)} times` : undefined,
        color: "accent",
      },
    );
  }
  cards.push({
    label: role === "user" ? "Highest friction model" : "Pottiest model",
    value: worst && hitsOf(worst) > 0 ? clip(worst.modelID, 18) : "—",
    sub: worst && hitsOf(worst) > 0 ? `${fmtInt(hitsOf(worst))} hits` : undefined,
  });
  return cards;
};

function Cards(props: { cards: Card[]; th: Palette }) {
  return (
    <box flexDirection="row" flexWrap="wrap" gap={1}>
      <For each={props.cards}>
        {(card) => (
          <box
            border
            borderColor={props.th().border}
            flexGrow={1}
            flexBasis={18}
            paddingLeft={1}
            paddingRight={1}
            flexDirection="column"
          >
            <text fg={props.th().textMuted}>{card.label}</text>
            <text fg={card.color ? props.th()[card.color] : props.th().text}>
              <b>{card.value}</b>
            </text>
            <text fg={props.th().textMuted}>{card.sub ?? " "}</text>
          </box>
        )}
      </For>
    </box>
  );
}

function Panel(props: { title: string; subtitle?: string; th: Palette; children?: unknown }) {
  return (
    <box
      border
      borderColor={props.th().border}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
    >
      <box flexDirection="row" gap={2}>
        <text fg={props.th().text}>
          <b>{props.title}</b>
        </text>
        <Show when={props.subtitle}>
          <text fg={props.th().textMuted}>{props.subtitle}</text>
        </Show>
      </box>
      {props.children as never}
    </box>
  );
}

function TrendChart(props: {
  stats: RoleStats;
  metric: MetricKey;
  sinceMs: number | undefined;
  th: Palette;
}) {
  const chart = () => buildChartBuckets(props.stats.byDay, props.sinceMs, Date.now());
  const metricLabel = () => METRICS.find((m) => m.key === props.metric)?.label ?? props.metric;
  const maxRate = () =>
    Math.max(
      0.0001,
      ...chart().buckets.map((b) => (b.totals.messages > 0 ? metricValue(b.totals, props.metric) / b.totals.messages : 0)),
    );
  const subtitle = () => {
    const per = chart().daysPerBucket;
    const span = per === 1 ? "each bar is one day" : `each bar is ${per} days`;
    return `${metricLabel()} rate per message · ${span} · m cycles metric`;
  };
  return (
    <Panel title="Trend" subtitle={subtitle()} th={props.th}>
      <For each={chart().buckets}>
        {(bucket) => {
          const hits = metricValue(bucket.totals, props.metric);
          const rate = bucket.totals.messages > 0 ? hits / bucket.totals.messages : 0;
          const cells = bar(rate / maxRate(), BAR_WIDTH);
          return (
            <text>
              <span style={{ fg: props.th().textMuted }}>{bucket.label.padStart(6)} </span>
              <span style={{ fg: props.th().accent }}>{cells.fill}</span>
              <span style={{ fg: props.th().border }}>{cells.rest}</span>
              <span style={{ fg: props.th().text }}> {fmtRate(hits, bucket.totals.messages).padStart(5)}</span>
              <span style={{ fg: props.th().textMuted }}>
                {"  "}
                {bucket.totals.messages > 0
                  ? `${fmtInt(hits)} hits / ${fmtInt(bucket.totals.messages)} msgs`
                  : "no messages"}
              </span>
            </text>
          );
        }}
      </For>
    </Panel>
  );
}

/** Model rows shown before the tail collapses into a hint; keeps the scrollbar usable in global scope. */
const MAX_MODEL_ROWS = 12;

function ModelTable(props: { role: Role; stats: RoleStats; width: number; th: Palette }) {
  const columns = () =>
    props.role === "user"
      ? (["MSGS", "CAPS%", "PROF%", "ANGST%", "FRICT%", "HITS%"] as const)
      : (["MSGS", "CAPS%", "PROF%", "HITS%"] as const);
  const numeric = (model: ModelTotals): string[] => {
    const cells = [
      fmtInt(model.messages),
      fmtRate(model.yelling, model.messages),
      fmtRate(model.profanity, model.messages),
    ];
    if (props.role === "user") {
      cells.push(fmtRate(model.anguish, model.messages), fmtRate(frictionOf(model), model.messages));
    }
    cells.push(fmtRate(hitsOf(model), model.messages));
    return cells;
  };
  const cellWidth = 7;
  const nameWidth = () => Math.max(16, props.width - 6 - columns().length * (cellWidth + 1));
  return (
    <Panel title="By model" subtitle="rates are per message · f filters" th={props.th}>
      <text fg={props.th().textMuted}>
        {"MODEL".padEnd(nameWidth())} {columns().map((c) => c.padStart(cellWidth)).join(" ")}
      </text>
      <For each={props.stats.byModel.slice(0, MAX_MODEL_ROWS)}>
        {(model) => (
          <text>
            <span style={{ fg: props.th().text }}>
              {clip(modelLabel(model), nameWidth() - 1).padEnd(nameWidth())}
            </span>
            <span style={{ fg: props.th().textMuted }}>
              {" "}
              {numeric(model).map((c) => c.padStart(cellWidth)).join(" ")}
            </span>
          </text>
        )}
      </For>
      <Show when={props.stats.byModel.length > MAX_MODEL_ROWS}>
        <text fg={props.th().textMuted}>
          {`… and ${fmtInt(props.stats.byModel.length - MAX_MODEL_ROWS)} more models · ${MODEL_FILTER_KEY} to filter`}
        </text>
      </Show>
      <Show when={props.stats.byModel.length === 0}>
        <text fg={props.th().textMuted}>No messages recorded in this range.</text>
      </Show>
    </Panel>
  );
}

function Breakdown(props: { role: Role; stats: RoleStats; th: Palette }) {
  const t = () => props.stats.totals;
  const rows = () => {
    const out: { label: string; total: number; rate: string; color: ColorToken }[] = [];
    const push = (label: string, total: number, color: ColorToken) =>
      out.push({ label, total, rate: fmtRate(total, t().messages), color });
    push("Yelling (CAPS)", t().yelling, "warning");
    push("Profanity", t().profanity, "error");
    if (props.role === "user") {
      push("Anguish (!!!, nooo, dude, :()", t().anguish, "info");
      push("Negation (no/nope/wrong)", t().negation, "info");
      push("Repetition (i meant, still doesnt)", t().repetition, "info");
      push("Blame (you didnt, stop X-ing)", t().blame, "info");
      push("Friction (neg + rep + blame)", frictionOf(t()), "accent");
    }
    push("All signals", hitsOf(t()), "accent");
    return out;
  };
  const avg = (total: number) => (t().messages > 0 ? Math.round(total / t().messages) : 0);
  return (
    <Panel title="Signal breakdown" subtitle="totals and share of messages in range" th={props.th}>
      <For each={rows()}>
        {(row) => (
          <text>
            <span style={{ fg: props.th().text }}>{row.label.padEnd(36)}</span>
            <span style={{ fg: props.th()[row.color] }}>{fmtInt(row.total).padStart(8)}</span>
            <span style={{ fg: props.th().textMuted }}>{row.rate.padStart(8)} of msgs</span>
          </text>
        )}
      </For>
      <text>
        <span style={{ fg: props.th().text }}>{"Message size".padEnd(36)}</span>
        <span style={{ fg: props.th().textMuted }}>
          {`avg ${fmtInt(avg(t().chars))} chars · ${fmtInt(avg(t().words))} words`}
        </span>
      </text>
    </Panel>
  );
}

function TopWords(props: { stats: RoleStats; th: Palette }) {
  const top = () => props.stats.words.slice(0, 12);
  return (
    <Panel title="Top offenders" subtitle="profanity by frequency" th={props.th}>
      <Show
        when={top().length > 0}
        fallback={<text fg={props.th().success}>Squeaky clean. Nothing to report.</text>}
      >
        <text>
          {top().flatMap((entry, index) => [
            <span style={{ fg: props.th().error }}>{entry.word}</span>,
            <span style={{ fg: props.th().textMuted }}>
              {` ×${fmtInt(entry.count)}${index < top().length - 1 ? "   " : ""}`}
            </span>,
          ])}
        </text>
      </Show>
    </Panel>
  );
}

function Chip(props: { label: string; active: boolean; th: Palette; onPick: () => void }) {
  return (
    <box
      onMouseUp={() => props.onPick()}
      backgroundColor={props.active ? props.th().accent : props.th().backgroundElement}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.active ? props.th().selectedListItemText : props.th().text}>{props.label}</text>
    </box>
  );
}

// --- plugin -----------------------------------------------------------------

const tui: TuiPlugin = async (api, options) => {
  const opts = parseOptions(options);
  const [role, setRole] = createSignal<Role>("user");
  const [scope, setScope] = createSignal<Scope>(opts.scope);
  const [range, setRange] = createSignal<RangeKey>(opts.range);
  const [metric, setMetric] = createSignal<MetricKey>("total");
  const [modelFilter, setModelFilter] = createSignal<string | undefined>(undefined);
  const [state, setState] = createSignal<LoadState>({ status: "idle" });
  let returnRoute: TuiRouteCurrent | undefined;
  let scroller: ScrollBoxRenderable | undefined;
  let loading = false;
  // Where `g` returns to when leaving the global scope. If the config itself
  // starts global, the first toggle drops to the whole project.
  let returnScope: Scope = opts.scope === "global" ? "project" : opts.scope;

  const th: Palette = () => api.theme.current;

  const sinceMs = (): number | undefined => {
    const ms = RANGES.find((r) => r.key === range())?.ms;
    return ms === undefined ? undefined : Date.now() - ms;
  };

  const load = async () => {
    if (loading) return;
    loading = true;
    const wantedScope = scope();
    setState({ status: "loading", done: 0, total: 0 });
    // Paint the loading state before any scanning work runs: the callers set
    // signals and start the scan in the same event handler, and without this
    // yield the first synchronous queries delay the repaint.
    await yieldToUI();
    try {
      const result = await scan(api, { ...opts, scope: wantedScope }, (done, total) =>
        setState({ status: "loading", done, total }),
      );
      setState({ status: "ready", ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message });
      api.ui.toast({ variant: "error", title: "mouth", message, duration: 5000 });
    } finally {
      loading = false;
    }
    // The scope can change while a scan is in flight (toggleGlobal is a no-op
    // then), and the header always renders the live scope — rescan instead of
    // leaving it next to the other scope's data.
    if (scope() !== wantedScope) void load();
  };

  const toggleGlobal = () => {
    if (scope() === "global") {
      setScope(returnScope);
    } else {
      returnScope = scope();
      setScope("global");
    }
    void load();
  };

  const open = () => {
    const current = api.route.current;
    if (current.name !== ROUTE) returnRoute = current;
    api.route.navigate(ROUTE);
    if (state().status === "idle" || state().status === "error") void load();
  };

  const close = () => {
    const back = returnRoute;
    if (back && back.name !== ROUTE) {
      api.route.navigate(back.name, "params" in back ? (back.params as Record<string, unknown>) : undefined);
    } else {
      api.route.navigate("home");
    }
  };

  const pickRole = (next: Role) => {
    setRole(next);
    if (!metricsForRole(next).some((m) => m.key === metric())) setMetric("total");
    setModelFilter(undefined);
  };

  const cycleMetric = () => {
    const list = metricsForRole(role());
    const index = list.findIndex((m) => m.key === metric());
    setMetric(list[(index + 1) % list.length].key);
  };

  const pickModel = () => {
    const value = state();
    if (value.status !== "ready") return;
    const models = modelsOf(value.records, role());
    if (models.length === 0) return;
    const DialogSelect = api.ui.DialogSelect;
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <DialogSelect
        title="Filter by model"
        options={[
          { title: "All models", value: "", description: "clear the filter" },
          ...models.map((m) => ({
            title: m.key,
            value: m.key,
            description: `${fmtInt(m.messages)} messages`,
          })),
        ]}
        onSelect={(option) => {
          api.ui.dialog.clear();
          setModelFilter(option.value === "" ? undefined : option.value);
        }}
      />
    ));
  };

  const scrollBy = (lines: number) => {
    if (!scroller) return;
    scroller.scrollTop = Math.max(0, scroller.scrollTop + lines);
  };

  api.keymap.registerLayer({
    commands: [
      {
        name: "mouth.behavior.open",
        title: "Mouth: behavior dashboard",
        category: "Mouth",
        namespace: "palette",
        slashName: "behavior",
        desc: "Measure profanity and friction in your sessions",
        run() {
          open();
        },
      },
    ],
  });

  api.keymap.registerLayer({
    mode: MODE,
    bindings: [
      { key: "escape", cmd: () => close(), desc: "Close dashboard" },
      { key: "q", cmd: () => close(), desc: "Close dashboard" },
      { key: "tab", cmd: () => pickRole(role() === "user" ? "assistant" : "user"), desc: "Toggle you / model" },
      { key: "m", cmd: () => cycleMetric(), desc: "Cycle trend metric" },
      { key: MODEL_FILTER_KEY, cmd: () => pickModel(), desc: "Filter by model" },
      { key: "g", cmd: () => toggleGlobal(), desc: "Toggle global scope" },
      { key: "r", cmd: () => void load(), desc: "Rescan sessions" },
      ...RANGES.map((r, index) => ({
        key: String(index + 1),
        cmd: () => setRange(r.key),
        desc: `Range ${r.label}`,
      })),
      { key: "j", cmd: () => scrollBy(2), desc: "Scroll down" },
      { key: "down", cmd: () => scrollBy(2), desc: "Scroll down" },
      { key: "k", cmd: () => scrollBy(-2), desc: "Scroll up" },
      { key: "up", cmd: () => scrollBy(-2), desc: "Scroll up" },
    ],
  });

  api.route.register([
    {
      name: ROUTE,
      render: () => {
        const popMode = api.mode.push(MODE);
        onCleanup(popMode);
        onCleanup(() => {
          scroller = undefined;
        });
        const dim = useTerminalDimensions();
        const width = () => dim().width;
        const stats = createMemo(() => {
          const value = state();
          if (value.status !== "ready") return undefined;
          return buildRoleStats(value.records, {
            role: role(),
            since: sinceMs(),
            model: modelFilter(),
          });
        });
        // opentui's slider clamps viewPortSize to the scroll range
        // (Math.min(size, max - min)), capping the thumb at 50% of the track
        // no matter how short the scroll distance is — with a 12-line range
        // the thumb renders half the track instead of ~80%. Pin the honest
        // thumb size (viewport/content) on the slider instance; recomputed
        // whenever the body changes, restored when content fits the viewport.
        createEffect(() => {
          const current = stats();
          if (!current || !scroller) return;
          const fix = () => {
            const box = scroller as any;
            const sb = box?.verticalScrollBar;
            const slider = sb?.slider;
            if (!slider || !box.viewport) return;
            const viewport = box.viewport.height;
            const content = sb.scrollSize;
            const virtualTrack = slider.height * 2; // half-block cell rendering
            if (!viewport || !content || !virtualTrack) return;
            if (!slider.__honestThumb) slider.__honestThumb = slider.getVirtualThumbSize;
            if (content <= viewport) {
              slider.getVirtualThumbSize = slider.__honestThumb;
              return;
            }
            const virtualThumb = Math.min(virtualTrack, Math.floor(virtualTrack * (viewport / content)));
            slider.getVirtualThumbSize = () => virtualThumb;
            sb.requestRender?.();
          };
          const first = setTimeout(fix, THUMB_FIX_DELAY_MS);
          const second = setTimeout(fix, THUMB_FIX_SETTLE_MS);
          onCleanup(() => {
            clearTimeout(first);
            clearTimeout(second);
          });
        });

        return (
          <box
            width={dim().width}
            height={dim().height}
            backgroundColor={th().backgroundPanel}
            flexDirection="column"
            paddingTop={1}
            paddingLeft={2}
            paddingRight={2}
          >
            <box flexShrink={0} flexDirection="row" justifyContent="space-between">
              <text>
                <span style={{ fg: th().accent }}>
                  <b>MOUTH</b>
                </span>
                <span style={{ fg: th().textMuted }}> measure what comes out of your model's mouth</span>
              </text>
              <text fg={th().textMuted}>tab view · 1-5 range · m metric · f model · g global · r rescan · esc close</text>
            </box>

            {/* flexShrink keeps these rows intact when the body overflows the fixed-height root — otherwise yoga eats their padding one line at a time */}
            <box flexShrink={0} flexDirection="row" gap={1} paddingTop={1} paddingBottom={1} flexWrap="wrap">
              <Chip label="you" active={role() === "user"} th={th} onPick={() => pickRole("user")} />
              <Chip label="model" active={role() === "assistant"} th={th} onPick={() => pickRole("assistant")} />
              <text fg={th().border}>│</text>
              <For each={RANGES}>
                {(r) => (
                  <Chip label={r.label} active={range() === r.key} th={th} onPick={() => setRange(r.key)} />
                )}
              </For>
              <text fg={th().border}>│</text>
              <Chip
                label={modelFilter() ? clip(modelFilter() ?? "", 28) : "all models"}
                active={modelFilter() !== undefined}
                th={th}
                onPick={pickModel}
              />
              <Show when={state().status === "ready"}>
                <text fg={th().textMuted}>
                  {(() => {
                    const value = state();
                    if (value.status !== "ready") return "";
                    const failed = value.failures > 0 ? ` · ${value.failures} failed` : "";
                    return ` ${fmtInt(value.sessions)} sessions (${scope()})${failed} · scanned ${clockLabel(value.loadedAt)}`;
                  })()}
                </text>
              </Show>
            </box>

            <Switch>
              <Match when={state().status === "loading"}>
                <box flexDirection="column" gap={1} paddingTop={1}>
                  <text fg={th().text}>Scanning sessions…</text>
                  <text>
                    {(() => {
                      const value = state();
                      if (value.status !== "loading") return "";
                      const ratio = value.total > 0 ? value.done / value.total : 0;
                      const cells = bar(ratio, 30);
                      return (
                        <>
                          <span style={{ fg: th().accent }}>{cells.fill}</span>
                          <span style={{ fg: th().border }}>{cells.rest}</span>
                          <span style={{ fg: th().textMuted }}>
                            {" "}
                            {value.done}/{value.total}
                          </span>
                        </>
                      );
                    })()}
                  </text>
                </box>
              </Match>
              <Match when={state().status === "error"}>
                <text fg={th().error}>
                  {(() => {
                    const value = state();
                    return value.status === "error" ? `Failed to load sessions: ${value.message}` : "";
                  })()}
                </text>
              </Match>
              <Match when={stats()} keyed>
                {(current: RoleStats) => (
                  <Show
                    when={current.totals.messages > 0}
                    fallback={
                      <text fg={th().textMuted}>
                        No {role() === "user" ? "user" : "model"} messages match the current filters.
                      </text>
                    }
                  >
                    <scrollbox ref={(el: ScrollBoxRenderable) => { scroller = el; }} flexGrow={1}>
                      {/* Panels draw their borders OUTSIDE their measured width (opentui), so
                          the content box must stay a few columns short of the scrollbox edge —
                          otherwise panel borders paint over the scrollbar column and the thumb
                          peeks through only in the gap rows between panels */}
                      <box flexDirection="column" gap={1} flexShrink={0} width={width() - BODY_INSET}>
                        <Cards cards={roleCards(role(), current)} th={th} />
                        <TrendChart stats={current} metric={metric()} sinceMs={sinceMs()} th={th} />
                        <ModelTable role={role()} stats={current} width={width() - BODY_INSET - PANEL_CHROME} th={th} />
                        <Breakdown role={role()} stats={current} th={th} />
                        <TopWords stats={current} th={th} />
                      </box>
                    </scrollbox>
                  </Show>
                )}
              </Match>
            </Switch>
          </box>
        );
      },
    },
  ]);
};

const plugin: TuiPluginModule & { id: string } = {
  id: "opencode-mouth",
  tui,
};

export default plugin;
