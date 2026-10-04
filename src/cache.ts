/**
 * Per-session ingestion markers for the global scan.
 *
 * Only the row-count fingerprint is stored: it detects sessions with new or
 * removed rows, which is enough to decide whether to re-read and re-ingest.
 * V2 sessions stream text into existing rows, so row counts cannot invalidate
 * those; the global scan always re-reads v2 sessions.
 *
 * Best-effort: any cache failure falls back to a full scan.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDatabase, transaction, type Connection } from "./sqlite.ts";
import { DB_PATH, type SessionFingerprint } from "./db.ts";

const STATE_DIR = process.env.MOUTH_INSTALL_STATE_DIR ?? `${process.env.HOME}/.local/share/opencode-mouth`;
const CACHE_PATH = join(STATE_DIR, "global-cache", "sessions.db");
const CACHE_VERSION = "v5";

let cache: Connection | null | undefined;

function openCache(): Connection | null {
  if (cache !== undefined) return cache;
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    const conn = openDatabase(CACHE_PATH, false);
    conn.exec(`
      CREATE TABLE IF NOT EXISTS session_fingerprints (
        session_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL
      );
    `);
    // Reclaim the pre-marker metrics cache; records now live in the stats DB.
    conn.exec("DROP TABLE IF EXISTS session_cache");
    cache = conn;
  } catch {
    cache = null;
  }
  return cache;
}

const key = (fp: SessionFingerprint): string => `${CACHE_VERSION}:${DB_PATH}:${fp.messages}:${fp.parts}`;

/** Whether the session's rows are already ingested at this fingerprint. */
export function isCachedSession(id: string, fp: SessionFingerprint): boolean {
  const conn = openCache();
  if (!conn) return false;
  try {
    const row = conn.prepare("SELECT fingerprint FROM session_fingerprints WHERE session_id = ?").get(id) as
      | { fingerprint: string }
      | undefined;
    return row?.fingerprint === key(fp);
  } catch {
    return false;
  }
}

export interface CacheEntry {
  id: string;
  fp: SessionFingerprint;
}

/** Record that a session's rows are ingested at this fingerprint. */
export function saveCachedSessions(entries: readonly CacheEntry[]): void {
  if (entries.length === 0) return;
  const conn = openCache();
  if (!conn) return;
  try {
    transaction(conn, () => {
      const insert = conn.prepare("INSERT OR REPLACE INTO session_fingerprints (session_id, fingerprint) VALUES (?, ?)");
      for (const entry of entries) insert.run(entry.id, key(entry.fp));
    });
  } catch {
    // best-effort
  }
}

/** Drop markers for sessions that no longer exist. */
export function pruneSessionCache(keepIds: readonly string[]): void {
  const conn = openCache();
  if (!conn) return;
  try {
    const keep = new Set(keepIds);
    const rows = conn.prepare("SELECT session_id FROM session_fingerprints").all() as Array<{ session_id: string }>;
    const stale = rows.map((row) => row.session_id).filter((id) => !keep.has(id));
    if (stale.length === 0) return;
    transaction(conn, () => {
      const remove = conn.prepare("DELETE FROM session_fingerprints WHERE session_id = ?");
      for (const id of stale) remove.run(id);
    });
  } catch {
    // best-effort
  }
}
