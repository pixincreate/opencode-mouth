/**
 * Stats store: per-message user rows and cached judge verdicts.
 *
 * Mirrors oh-my-pi's stats database (packages/stats/src/db.ts, MIT): scans
 * ingest one row per user message, and the dashboard reads pending prose and
 * frustration counts straight from SQL, so judging never needs a rescan.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FrustrationVerdict, PendingProse } from "./judge.ts";
import { openDatabase, transaction, type Connection } from "./sqlite.ts";

/**
 * Below this judged share a row is mostly classified by the regex fallback;
 * the dashboard can hide or flag such rows.
 */
const MIN_JUDGED_SHARE = 0.5;

export interface FrustrationCounts {
  messages: number;
  judged: number;
  annoyed: number;
  atAssistant: number;
  angry: number;
}

/** All-zero tallies, for empty ranges and unavailable databases. */
export function zeroCounts(): FrustrationCounts {
  return { messages: 0, judged: 0, annoyed: 0, atAssistant: 0, angry: 0 };
}

export interface FrustrationModelStats extends FrustrationCounts {
  key: string;
  model: string;
  provider: string;
  firstSeen: number;
}

export interface FrustrationDay extends FrustrationCounts {
  day: string;
}

export interface UserMessageRow {
  sessionFile: string;
  entryId: string;
  folder: string;
  timestamp: number;
  model: string | null;
  provider: string | null;
  chars: number;
  words: number;
  yelling: number;
  profanity: number;
  anguish: number;
  negation: number;
  repetition: number;
  blame: number;
  prose: string;
  proseHash: string;
}

export function isMostlyRegex(counts: FrustrationCounts): boolean {
  return counts.messages > 0 && counts.judged / counts.messages < MIN_JUDGED_SHARE;
}

const STATE_DIR = process.env.MOUTH_INSTALL_STATE_DIR ?? `${process.env.HOME ?? ""}/.local/share/opencode-mouth`;

function statsPath(): string {
  return join(STATE_DIR, "stats.db");
}

let store: Connection | undefined;
let disabled = false;

function open(): Connection | undefined {
  if (disabled) return undefined;
  if (store) return store;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const db = openDatabase(statsPath(), false);
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_file TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT,
        provider TEXT,
        chars INTEGER NOT NULL,
        words INTEGER NOT NULL,
        yelling INTEGER NOT NULL,
        profanity INTEGER NOT NULL,
        anguish INTEGER NOT NULL,
        negation INTEGER NOT NULL DEFAULT 0,
        repetition INTEGER NOT NULL DEFAULT 0,
        blame INTEGER NOT NULL DEFAULT 0,
        prose TEXT NOT NULL DEFAULT '',
        prose_hash TEXT NOT NULL DEFAULT '',
        UNIQUE(session_file, entry_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_messages_timestamp ON user_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_messages_entry_timestamp ON user_messages(entry_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_user_messages_timestamp_model ON user_messages(timestamp, model, provider);
      CREATE INDEX IF NOT EXISTS idx_user_messages_prose_hash ON user_messages(prose_hash);
      CREATE TABLE IF NOT EXISTS frustration_verdicts (
        prose_hash TEXT PRIMARY KEY,
        p_annoyed REAL NOT NULL,
        p_angry REAL NOT NULL,
        target TEXT NOT NULL,
        judge TEXT NOT NULL,
        judged_at INTEGER NOT NULL
      );
    `);
    store = db;
    return store;
  } catch {
    disabled = true;
    return undefined;
  }
}

const UPSERT_SQL = `
  INSERT INTO user_messages (
    session_file, entry_id, folder, timestamp, model, provider,
    chars, words, yelling, profanity, anguish, negation, repetition, blame, prose, prose_hash
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_file, entry_id) DO UPDATE SET
    folder = excluded.folder,
    timestamp = excluded.timestamp,
    model = excluded.model,
    provider = excluded.provider,
    chars = excluded.chars,
    words = excluded.words,
    yelling = excluded.yelling,
    profanity = excluded.profanity,
    anguish = excluded.anguish,
    negation = excluded.negation,
    repetition = excluded.repetition,
    blame = excluded.blame,
    prose = excluded.prose,
    prose_hash = excluded.prose_hash
`;

/** Ingest or refresh rows for the scanned messages. Best-effort. */
export function saveUserMessages(rows: readonly UserMessageRow[]): void {
  if (rows.length === 0) return;
  const db = open();
  if (!db) return;
  try {
    transaction(db, () => {
      const statement = db.prepare(UPSERT_SQL);
      for (const row of rows) {
        statement.run(
          row.sessionFile,
          row.entryId,
          row.folder,
          row.timestamp,
          row.model,
          row.provider,
          row.chars,
          row.words,
          row.yelling,
          row.profanity,
          row.anguish,
          row.negation,
          row.repetition,
          row.blame,
          row.prose,
          row.proseHash,
        );
      }
    });
  } catch {
    // Best-effort: the dashboard falls back to empty stats.
  }
}

/** Cache judge verdicts in one transaction, keyed by prose hash. Best-effort. */
export function saveVerdicts(verdicts: readonly FrustrationVerdict[]): void {
  if (verdicts.length === 0) return;
  const db = open();
  if (!db) return;
  try {
    transaction(db, () => {
      const statement = db.prepare(
        `INSERT OR REPLACE INTO frustration_verdicts (prose_hash, p_annoyed, p_angry, target, judge, judged_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const verdict of verdicts) {
        statement.run(
          verdict.proseHash,
          verdict.pAnnoyed,
          verdict.pAngry,
          verdict.target,
          verdict.judge,
          verdict.judgedAt,
        );
      }
    });
  } catch {
    // Best-effort: a lost verdict only means the message is judged again.
  }
}

/** Cache one judge verdict. Best-effort. */
export function saveVerdict(verdict: FrustrationVerdict): void {
  saveVerdicts([verdict]);
}

function rangeClause(sinceMs: number | undefined): { sql: string; params: number[] } {
  return sinceMs === undefined ? { sql: "", params: [] } : { sql: " AND u.timestamp >= ?", params: [sinceMs] };
}

const COUNT_COLUMNS = `
  COUNT(*) AS messages,
  COALESCE(SUM(CASE WHEN v.prose_hash IS NOT NULL THEN 1 ELSE 0 END), 0) AS judged,
  COALESCE(SUM(CASE
    WHEN v.prose_hash IS NOT NULL THEN (v.p_annoyed >= 0.5)
    ELSE (u.yelling + u.profanity + u.anguish + u.negation + u.repetition + u.blame > 0)
  END), 0) AS annoyed,
  COALESCE(SUM(CASE
    WHEN v.prose_hash IS NOT NULL THEN (v.p_annoyed >= 0.5 AND v.target = 'assistant')
    ELSE (u.negation + u.repetition + u.blame > 0)
  END), 0) AS at_assistant,
  COALESCE(SUM(CASE
    WHEN v.prose_hash IS NOT NULL THEN (v.p_annoyed >= 0.5 AND v.target = 'assistant' AND v.p_angry >= 0.5)
    ELSE ((u.negation + u.repetition + u.blame > 0) AND (u.profanity > 0 OR u.yelling > 0))
  END), 0) AS angry
`;

type CountRow = {
  messages: number;
  judged: number;
  annoyed: number;
  at_assistant: number;
  angry: number;
};

const toCounts = (row: CountRow | undefined): FrustrationCounts => ({
  messages: Number(row?.messages ?? 0),
  judged: Number(row?.judged ?? 0),
  annoyed: Number(row?.annoyed ?? 0),
  atAssistant: Number(row?.at_assistant ?? 0),
  angry: Number(row?.angry ?? 0),
});

/** Overall frustration tallies for user messages with prose. Best-effort. */
export function frustrationOverall(sinceMs?: number): FrustrationCounts {
  const db = open();
  if (!db) return zeroCounts();
  const range = rangeClause(sinceMs);
  try {
    const row = db
      .prepare(
        `SELECT ${COUNT_COLUMNS}
         FROM user_messages u LEFT JOIN frustration_verdicts v ON v.prose_hash = u.prose_hash
         WHERE u.prose != ''${range.sql}`,
      )
      .get(...range.params) as CountRow | undefined;
    return toCounts(row);
  } catch {
    return zeroCounts();
  }
}

/** Frustration tallies per model, first seen ascending. Best-effort. */
export function frustrationByModel(sinceMs?: number): FrustrationModelStats[] {
  const db = open();
  if (!db) return [];
  const range = rangeClause(sinceMs);
  try {
    const rows = db
      .prepare(
        `SELECT u.model AS model, u.provider AS provider, MIN(u.timestamp) AS first_seen, ${COUNT_COLUMNS}
         FROM user_messages u LEFT JOIN frustration_verdicts v ON v.prose_hash = u.prose_hash
         WHERE u.prose != '' AND u.model IS NOT NULL${range.sql}
         GROUP BY u.model, u.provider
         ORDER BY first_seen ASC, u.model ASC`,
      )
      .all(...range.params) as Array<CountRow & { model: string; provider: string | null; first_seen: number }>;
    return rows.map((row) => ({
      key: `${row.provider ?? "unknown"}/${row.model}`,
      model: row.model,
      provider: row.provider ?? "unknown",
      firstSeen: Number(row.first_seen),
      ...toCounts(row),
    }));
  } catch {
    return [];
  }
}

/** Frustration tallies per local day, ascending. Best-effort. */
export function frustrationByDay(sinceMs?: number): FrustrationDay[] {
  const db = open();
  if (!db) return [];
  const range = rangeClause(sinceMs);
  try {
    const rows = db
      .prepare(
        `SELECT date(u.timestamp / 1000, 'unixepoch', 'localtime') AS day, ${COUNT_COLUMNS}
         FROM user_messages u LEFT JOIN frustration_verdicts v ON v.prose_hash = u.prose_hash
         WHERE u.prose != ''${range.sql}
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(...range.params) as Array<CountRow & { day: string }>;
    return rows.map((row) => ({ day: row.day, ...toCounts(row) }));
  } catch {
    return [];
  }
}

/** Unique unjudged prose in the range, one entry per hash. Best-effort. */
export function pendingProse(sinceMs?: number): PendingProse[] {
  const db = open();
  if (!db) return [];
  const range = rangeClause(sinceMs);
  try {
    const rows = db
      .prepare(
        `SELECT u.prose_hash AS hash, MIN(u.prose) AS prose
         FROM user_messages u
         WHERE u.prose != ''${range.sql}
           AND NOT EXISTS (SELECT 1 FROM frustration_verdicts v WHERE v.prose_hash = u.prose_hash)
         GROUP BY u.prose_hash`,
      )
      .all(...range.params) as Array<{ hash: string; prose: string }>;
    return rows.map((row) => ({ hash: row.hash, prose: row.prose }));
  } catch {
    return [];
  }
}
