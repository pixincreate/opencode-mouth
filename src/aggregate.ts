/**
 * Aggregates per-message behavior metrics into dashboard statistics.
 *
 * The scanner produces one `MetricRecord` per message. Aggregation is a
 * pure function over those records plus a filter, so the dashboard can
 * re-derive totals, per-model, per-day, and word-frequency views when the
 * user changes the time range or model filter without rescanning.
 */

import { analyzeAssistantMessage, analyzeUserMessage, type BehaviorMetrics } from "./metrics.ts";

export type Role = "user" | "assistant";

export interface MessageSample {
  role: Role;
  providerID: string;
  modelID: string;
  /** Epoch milliseconds. */
  created: number;
  text: string;
}

export interface MetricRecord {
  role: Role;
  providerID: string;
  modelID: string;
  created: number;
  metrics: BehaviorMetrics;
}

export interface Totals {
  messages: number;
  chars: number;
  words: number;
  yelling: number;
  profanity: number;
  anguish: number;
  negation: number;
  repetition: number;
  blame: number;
}

export interface ModelTotals extends Totals {
  providerID: string;
  modelID: string;
}

export interface DayTotals extends Totals {
  /** Local date key, `YYYY-MM-DD`. */
  day: string;
}

export interface WordCount {
  word: string;
  count: number;
}

export interface RoleStats {
  totals: Totals;
  /** Sorted by message count, descending. */
  byModel: ModelTotals[];
  /** Sorted by day, ascending. */
  byDay: DayTotals[];
  /** Sorted by count, descending. */
  words: WordCount[];
}

export interface StatsFilter {
  role: Role;
  /** Keep records with `created >= since` (epoch ms). Omit for all time. */
  since?: number;
  /** Keep records for one model, keyed `providerID/modelID`. Omit for all. */
  model?: string;
}

export const frictionOf = (t: Totals): number => t.negation + t.repetition + t.blame;

export const hitsOf = (t: Totals): number => t.yelling + t.profanity + t.anguish + frictionOf(t);

export function emptyTotals(): Totals {
  return {
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
}

/** Local date key for an epoch-milliseconds timestamp. */
export function dayKey(created: number): string {
  const d = new Date(created);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export const modelKey = (record: { providerID: string; modelID: string }): string =>
  `${record.providerID}/${record.modelID}`;

/** Analyze one message into a metric record. */
export function toRecord(sample: MessageSample): MetricRecord {
  const metrics =
    sample.role === "user" ? analyzeUserMessage(sample.text) : analyzeAssistantMessage(sample.text);
  return {
    role: sample.role,
    providerID: sample.providerID,
    modelID: sample.modelID,
    created: sample.created,
    metrics,
  };
}

function addInto(into: Totals, metrics: BehaviorMetrics): void {
  into.messages += 1;
  into.chars += metrics.chars;
  into.words += metrics.words;
  into.yelling += metrics.yelling;
  into.profanity += metrics.profanity;
  into.anguish += metrics.anguish;
  into.negation += metrics.negation;
  into.repetition += metrics.repetition;
  into.blame += metrics.blame;
}

export function matchesFilter(record: MetricRecord, filter: StatsFilter): boolean {
  if (record.role !== filter.role) return false;
  if (filter.since !== undefined && record.created < filter.since) return false;
  if (filter.model !== undefined && modelKey(record) !== filter.model) return false;
  return true;
}

/** Derive role statistics from records under a filter. */
export function buildRoleStats(records: readonly MetricRecord[], filter: StatsFilter): RoleStats {
  const totals = emptyTotals();
  const byModel = new Map<string, ModelTotals>();
  const byDay = new Map<string, DayTotals>();
  const words = new Map<string, number>();

  for (const record of records) {
    if (!matchesFilter(record, filter)) continue;

    addInto(totals, record.metrics);

    const mKey = modelKey(record);
    let model = byModel.get(mKey);
    if (!model) {
      model = { ...emptyTotals(), providerID: record.providerID, modelID: record.modelID };
      byModel.set(mKey, model);
    }
    addInto(model, record.metrics);

    const dKey = dayKey(record.created);
    let daily = byDay.get(dKey);
    if (!daily) {
      daily = { ...emptyTotals(), day: dKey };
      byDay.set(dKey, daily);
    }
    addInto(daily, record.metrics);

    for (const [word, count] of Object.entries(record.metrics.profanityWords)) {
      words.set(word, (words.get(word) ?? 0) + count);
    }
  }

  return {
    totals,
    byModel: [...byModel.values()].sort((a, b) => b.messages - a.messages),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    words: [...words.entries()]
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)),
  };
}

/** Distinct models present in the records for a role, sorted by frequency. */
export function modelsOf(records: readonly MetricRecord[], role: Role): { key: string; messages: number }[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.role !== role) continue;
    const key = modelKey(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, messages]) => ({ key, messages }))
    .sort((a, b) => b.messages - a.messages);
}
