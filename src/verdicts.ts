/**
 * Frustration verdict and prose store.
 *
 * Judge verdicts are keyed by prose hash and shared across sessions, so the
 * same message is never judged twice. The stripped prose itself is stored too:
 * cost estimates and judge runs need the text of cached and global sessions
 * without rescanning OpenCode's database. Both tables live in a small SQLite
 * database under the mouth state directory. Everything here is best-effort:
 * on any error the store disables itself and the dashboard falls back to
 * regex signals.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FrustrationTarget, FrustrationVerdict, PendingProse } from "./judge.ts";
import { openDatabase, transaction, type Connection } from "./sqlite.ts";

const CHUNK = 500;

function storePath(): string {
  const stateDir =
    process.env.MOUTH_INSTALL_STATE_DIR ?? `${process.env.HOME}/.local/share/opencode-mouth`;
  return join(stateDir, "judge", "verdicts.db");
}

let db: Connection | null = null;

function openStore(): Connection | null {
  if (db) return db;
  try {
    const path = storePath();
    mkdirSync(join(path, ".."), { recursive: true });
    db = openDatabase(path);
    db.exec(
      `CREATE TABLE IF NOT EXISTS frustration_prose (
         prose_hash TEXT PRIMARY KEY,
         prose      TEXT NOT NULL,
         stored_at  INTEGER NOT NULL
       );
       CREATE TABLE IF NOT EXISTS frustration_verdicts (
         prose_hash TEXT PRIMARY KEY,
         p_annoyed  REAL NOT NULL,
         p_angry    REAL NOT NULL,
         target     TEXT NOT NULL,
         judge      TEXT NOT NULL,
         judged_at  INTEGER NOT NULL
       )`,
    );
    return db;
  } catch {
    return null;
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size) as T[];
}

/** Store stripped prose so later runs can judge it without rescanning. */
export function saveProse(entries: readonly PendingProse[]): void {
  if (entries.length === 0) return;
  const conn = openStore();
  if (!conn) return;
  try {
    const insert = conn.prepare(
      `INSERT OR IGNORE INTO frustration_prose (prose_hash, prose, stored_at) VALUES (?, ?, ?)`,
    );
    const now = Date.now();
    transaction(conn, () => {
      for (const entry of entries) insert.run(entry.hash, entry.prose, now);
    });
  } catch {
    /* store is best-effort */
  }
}

/** Cache one verdict as soon as the judge returns it. */
export function saveVerdict(verdict: FrustrationVerdict): void {
  const conn = openStore();
  if (!conn) return;
  try {
    conn
      .prepare(
        `INSERT OR REPLACE INTO frustration_verdicts (prose_hash, p_annoyed, p_angry, target, judge, judged_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        verdict.proseHash,
        verdict.pAnnoyed,
        verdict.pAngry,
        verdict.target,
        verdict.judge,
        verdict.judgedAt,
      );
  } catch {
    /* store is best-effort */
  }
}

/** Cached verdicts for the given prose hashes; missing hashes are absent. */
export function loadVerdicts(hashes: readonly string[]): Map<string, FrustrationVerdict> {
  const verdicts = new Map<string, FrustrationVerdict>();
  const conn = openStore();
  if (!conn || hashes.length === 0) return verdicts;
  try {
    for (const chunk of chunks(hashes, CHUNK)) {
      const rows = conn
        .prepare(
          `SELECT prose_hash, p_annoyed, p_angry, target, judge, judged_at
           FROM frustration_verdicts WHERE prose_hash IN (${placeholders(chunk.length)})`,
        )
        .all(...chunk) as Array<{
        prose_hash: string;
        p_annoyed: number;
        p_angry: number;
        target: string;
        judge: string;
        judged_at: number;
      }>;
      for (const row of rows) {
        verdicts.set(row.prose_hash, {
          proseHash: row.prose_hash,
          pAnnoyed: row.p_annoyed,
          pAngry: row.p_angry,
          target: row.target as FrustrationTarget,
          judge: row.judge,
          judgedAt: row.judged_at,
        });
      }
    }
  } catch {
    /* store is best-effort */
  }
  return verdicts;
}

/** Stored prose for hashes that have no verdict yet. */
export function loadPendingProse(hashes: readonly string[]): PendingProse[] {
  const pending: PendingProse[] = [];
  const conn = openStore();
  if (!conn || hashes.length === 0) return pending;
  try {
    for (const chunk of chunks(hashes, CHUNK)) {
      const rows = conn
        .prepare(
          `SELECT p.prose_hash AS hash, p.prose AS prose
           FROM frustration_prose p
           LEFT JOIN frustration_verdicts v ON v.prose_hash = p.prose_hash
           WHERE v.prose_hash IS NULL AND p.prose_hash IN (${placeholders(chunk.length)})`,
        )
        .all(...chunk) as Array<{ hash: string; prose: string }>;
      for (const row of rows) pending.push({ hash: row.hash, prose: row.prose });
    }
  } catch {
    /* store is best-effort */
  }
  return pending;
}
