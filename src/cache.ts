/**
 * Per-session metrics cache for the global scan.
 *
 * Global sessions are immutable once written, so a scan only needs to re-read
 * sessions whose rows changed. Each session's MetricRecords are stored in a
 * small SQLite database under the mouth state directory, keyed by the
 * session's row counts (see db.ts). Counts detect every added or removed
 * message/part — which covers all streaming writes — but not an in-place edit
 * of an existing part with no row change; the next added row refreshes it.
 * Everything here is best-effort: on any error the cache disables itself and
 * the scan proceeds uncached.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MetricRecord } from "./aggregate.ts";
import { chunk, placeholders, type SessionFingerprint } from "./db.ts";

const STATE_DIR = process.env.MOUTH_INSTALL_STATE_DIR ?? `${process.env.HOME}/.local/share/opencode-mouth`;
const CACHE_PATH = join(STATE_DIR, "global-cache", "sessions.db");

let db: Database | null = null;

function openCache(): Database | null {
  if (db) return db;
  try {
    mkdirSync(join(CACHE_PATH, ".."), { recursive: true });
    db = new Database(CACHE_PATH);
    db.exec(
      `CREATE TABLE IF NOT EXISTS session_cache (
         session_id  TEXT PRIMARY KEY,
         fingerprint TEXT NOT NULL,
         records     TEXT NOT NULL
       )`,
    );
    return db;
  } catch {
    return null;
  }
}

/**
 * Bump when the scoring engine or MetricRecord shape changes: cached records
 * were produced by whatever version saved them, and the key is the only
 * invalidation signal for sessions whose row counts did not change.
 */
const CACHE_VERSION = "v2";

const key = (fp: SessionFingerprint): string => `${CACHE_VERSION}:${fp.messages}:${fp.parts}`;

/** Load cached records for a session whose fingerprint still matches. */
export function loadCachedSession(id: string, fp: SessionFingerprint): MetricRecord[] | undefined {
  const conn = openCache();
  if (!conn) return undefined;
  try {
    const row = conn
      .prepare(`SELECT fingerprint, records FROM session_cache WHERE session_id = ?`)
      .get(id) as { fingerprint: string; records: string } | null;
    if (!row || row.fingerprint !== key(fp)) return undefined;
    return JSON.parse(row.records) as MetricRecord[];
  } catch {
    return undefined;
  }
}

export interface CacheEntry {
  id: string;
  fp: SessionFingerprint;
  records: readonly MetricRecord[];
}

/** Store a scan's session records in one transaction. Failures are ignored. */
export function saveCachedSessions(entries: readonly CacheEntry[]): void {
  if (entries.length === 0) return;
  const conn = openCache();
  if (!conn) return;
  try {
    const save = conn.prepare(
      `INSERT OR REPLACE INTO session_cache (session_id, fingerprint, records) VALUES (?, ?, ?)`,
    );
    conn.transaction(() => {
      for (const entry of entries) save.run(entry.id, key(entry.fp), JSON.stringify(entry.records));
    })();
  } catch {
    /* cache is best-effort */
  }
}

/** Drop cache entries for sessions that fell out of the selected set. */
export function pruneSessionCache(keepIds: readonly string[]): void {
  const conn = openCache();
  if (!conn) return;
  try {
    for (const group of chunk(keepIds)) {
      conn
        .prepare(
          `DELETE FROM session_cache WHERE session_id NOT IN (${placeholders(group.length)})`,
        )
        .run(...group);
    }
  } catch {
    /* cache is best-effort */
  }
}
