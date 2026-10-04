/**
 * Frustration aggregation: classify user messages by their cached judge
 * verdict when one exists, otherwise by the regex signals stored at ingest,
 * then tally overall and per model.
 *
 * Rules mirror oh-my-pi's FRUSTRATION_COUNTS_SQL (MIT):
 *   judged      = a cached verdict exists
 *   annoyed     = P(level 2) + P(level 3) ≥ 0.5, else yelling + profanity +
 *                 anguish + negation + repetition + blame > 0
 *   atAssistant = annoyed && target = assistant, else negation + repetition +
 *                 blame > 0
 *   angry       = atAssistant && P(level 3) ≥ 0.5, else atAssistant &&
 *                 (profanity > 0 || yelling > 0)
 * Each message counts once; annoyed ⊇ atAssistant ⊇ angry.
 */

import type { MetricRecord, StatsFilter } from "./aggregate.ts";
import { dayKey, matchesFilter, modelKey } from "./aggregate.ts";
import type { FrustrationVerdict } from "./judge.ts";

export interface FrustrationCounts {
  messages: number;
  judged: number;
  annoyed: number;
  atAssistant: number;
  angry: number;
}

export interface FrustrationModelStats extends FrustrationCounts {
  key: string;
  providerID: string;
  modelID: string;
  firstSeen: number;
}

export interface FrustrationStats {
  overall: FrustrationCounts;
  byModel: FrustrationModelStats[];
}

export interface FrustrationDay extends FrustrationCounts {
  day: string;
}

/**
 * Below this judged share a row is mostly classified by the regex fallback;
 * the dashboard can hide or flag such rows.
 */
export const MIN_JUDGED_SHARE = 0.5;

export function isMostlyRegex(counts: FrustrationCounts): boolean {
  return counts.messages > 0 && counts.judged / counts.messages < MIN_JUDGED_SHARE;
}

export interface FrustrationClassification {
  judged: boolean;
  annoyed: boolean;
  atAssistant: boolean;
  angry: boolean;
}

/** Classify one user message by its verdict, or by regex signals without one. */
export function classifyRecord(
  record: MetricRecord,
  verdict: FrustrationVerdict | undefined,
): FrustrationClassification {
  if (verdict) {
    const annoyed = verdict.pAnnoyed >= 0.5;
    const atAssistant = annoyed && verdict.target === "assistant";
    return { judged: true, annoyed, atAssistant, angry: atAssistant && verdict.pAngry >= 0.5 };
  }
  const metrics = record.metrics;
  const atAssistant = metrics.negation + metrics.repetition + metrics.blame > 0;
  const annoyed =
    metrics.yelling + metrics.profanity + metrics.anguish + metrics.negation + metrics.repetition + metrics.blame >
    0;
  return {
    judged: false,
    annoyed,
    atAssistant,
    angry: atAssistant && (metrics.profanity > 0 || metrics.yelling > 0),
  };
}

function emptyCounts(): FrustrationCounts {
  return { messages: 0, judged: 0, annoyed: 0, atAssistant: 0, angry: 0 };
}

function addClassification(counts: FrustrationCounts, classification: FrustrationClassification): void {
  counts.messages++;
  if (classification.judged) counts.judged++;
  if (classification.annoyed) counts.annoyed++;
  if (classification.atAssistant) counts.atAssistant++;
  if (classification.angry) counts.angry++;
}

/**
 * User messages with prose, matching the filter. Messages that never got a
 * model (mouth stores `unknown`) only feed the overall tally, like upstream's
 * null-model rows.
 */
function* counted(
  records: readonly MetricRecord[],
  verdicts: ReadonlyMap<string, FrustrationVerdict>,
  filter: StatsFilter,
): Generator<{ record: MetricRecord; classification: FrustrationClassification }> {
  for (const record of records) {
    if (record.role !== "user" || !record.proseHash) continue;
    if (!matchesFilter(record, filter)) continue;
    yield { record, classification: classifyRecord(record, verdicts.get(record.proseHash)) };
  }
}

/** Overall and per-model frustration tallies for the filtered records. */
export function buildFrustrationStats(
  records: readonly MetricRecord[],
  verdicts: ReadonlyMap<string, FrustrationVerdict>,
  filter: StatsFilter,
): FrustrationStats {
  const overall = emptyCounts();
  const byModel = new Map<string, FrustrationModelStats>();
  for (const { record, classification } of counted(records, verdicts, filter)) {
    addClassification(overall, classification);
    if (record.providerID === "unknown" && record.modelID === "unknown") continue;
    const key = modelKey(record);
    let row = byModel.get(key);
    if (!row) {
      row = {
        key,
        providerID: record.providerID,
        modelID: record.modelID,
        firstSeen: record.created,
        ...emptyCounts(),
      };
      byModel.set(key, row);
    }
    row.firstSeen = Math.min(row.firstSeen, record.created);
    addClassification(row, classification);
  }
  return {
    overall,
    byModel: [...byModel.values()].sort((a, b) => a.firstSeen - b.firstSeen || a.key.localeCompare(b.key)),
  };
}

/** Frustration tallies per local day, ascending. */
export function buildFrustrationByDay(
  records: readonly MetricRecord[],
  verdicts: ReadonlyMap<string, FrustrationVerdict>,
  filter: StatsFilter,
): FrustrationDay[] {
  const byDay = new Map<string, FrustrationDay>();
  for (const { record, classification } of counted(records, verdicts, filter)) {
    const day = dayKey(record.created);
    let row = byDay.get(day);
    if (!row) {
      row = { day, ...emptyCounts() };
      byDay.set(day, row);
    }
    addClassification(row, classification);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
