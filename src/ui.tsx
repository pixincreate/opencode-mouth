/** @jsxImportSource @opentui/solid */
/**
 * Shared dashboard helpers: options, formatting, small components, and chart
 * bucketing used by both the behavior and frustration routes.
 */
import { For, Show } from "solid-js";
import { dayKey, type DayTotals, type ModelTotals, type Totals } from "./aggregate.ts";
import type { Palette as ThemePalette } from "./theme.ts";

export type Palette = () => ThemePalette;

export type ColorToken = "primary" | "accent" | "error" | "warning" | "info" | "success" | "text" | "textMuted";

// --- options ----------------------------------------------------------------

export const DEFAULT_SESSION_LIMIT = 200;

export const RANGES = [
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "90d", label: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "all", ms: undefined },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export interface MouthOptions {
  /** Number of most recent sessions to scan. */
  sessionLimit: number;
  /** Session scope: the whole project, only the current directory, or all sessions globally. */
  scope: "project" | "directory" | "global";
  /** Initial time range filter. */
  range: RangeKey;
}

export type Scope = MouthOptions["scope"];

export const parseOptions = (options: unknown): MouthOptions => {
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

export const rangeSince = (range: RangeKey): number | undefined => {
  const ms = RANGES.find((r) => r.key === range)?.ms;
  return ms === undefined ? undefined : Date.now() - ms;
};

// --- formatting -------------------------------------------------------------

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

export const fmtRate = (hits: number, messages: number): string => {
  if (messages <= 0) return "-";
  const pct = (hits / messages) * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
};

export const perHundred = (hits: number, messages: number): string | undefined => {
  if (messages <= 0 || hits === 0) return undefined;
  return `${((hits / messages) * 100).toFixed(1)} per 100 msgs`;
};

export const fmtCost = (usd: number): string => {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dayLabel = (day: string): string => {
  const [, month, date] = day.split("-");
  const index = Number(month) - 1;
  return `${MONTHS[index] ?? month} ${Number(date)}`;
};

export const clockLabel = (ts: number): string => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const modelLabel = (model: ModelTotals): string => `${model.providerID}/${model.modelID}`;

export const clip = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

/** Replace the home prefix so scanned paths stay short in the header. */
export const shortenPath = (path: string): string => {
  const home = process.env.HOME;
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

export const bar = (ratio: number, width: number): { fill: string; rest: string } => {
  const clamped = Math.max(0, Math.min(1, ratio));
  const cells = clamped > 0 ? Math.max(1, Math.round(clamped * width)) : 0;
  return { fill: "█".repeat(cells), rest: "░".repeat(width - cells) };
};

// --- trend chart buckets ----------------------------------------------------

export const BAR_WIDTH = 22;
export const MAX_CHART_BARS = 15;

export interface ChartBucket {
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

// --- components -------------------------------------------------------------

export interface Card {
  label: string;
  value: string;
  sub?: string;
  color?: ColorToken;
}

export function Cards(props: { cards: Card[]; th: Palette }) {
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

export function Panel(props: { title: string; subtitle?: string; th: Palette; children?: unknown }) {
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

export function Chip(props: { label: string; active: boolean; th: Palette; onPick: () => void }) {
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
