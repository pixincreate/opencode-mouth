/**
 * Direct SQLite reader for the OpenCode database.
 *
 * Used when scope is "global" — bypasses the SDK and reads
 * ~/.local/share/opencode/opencode.db directly.
 *
 * bun:sqlite, not node:sqlite: the TUI plugin runs inside opencode's embedded
 * Bun runtime, which does not implement node:sqlite.
 *
 * Message and part rows carry their full JSON in `data`, and a few rows are
 * enormous (session summaries can exceed 30 MB). Reading those blobs whole
 * costs seconds, so every query here either extracts the small fields it
 * needs with json_extract, or uses substr on a short prefix — SQLite only
 * loads the overflow pages the prefix touches — before fetching full blobs
 * for just the handful of rows that matter (text parts).
 */

import { openDatabase, type Connection } from "./sqlite.ts";
import type { MessageSample } from "./aggregate.ts";
import type { ModelRef, SessionMessageInfo } from "@opencode/client";
import { v2Samples } from "./messages.ts";

export const DB_PATH = process.env.OPENCODE_DB ?? `${process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`}/opencode/opencode.db`;

/** Serialized text parts always start with the type field; prefix length drives the substr check. */
const TEXT_PART_PREFIX = '{"type":"text"';

let db: Connection | null = null;

function hasTable(name: string): boolean {
  return !!openDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function openDb(): Connection {
  if (db) return db;
  db = openDatabase(DB_PATH, true);
  return db;
}

/** SQLite's default host parameter ceiling has grown over versions; stay under all of them. */
const PARAM_CHUNK = 500;

/** Build a `?,?,?` placeholder list for one IN clause. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

export function chunk<T>(items: readonly T[], size = PARAM_CHUNK): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export interface SessionRow {
  id: string;
  message_count: number;
  part_count: number;
  source: number;
}

/**
 * Query root sessions from the DB, most recently active first.
 *
 * Root = no parent_id, the same structural rule the SDK's `roots: true` uses —
 * subagent sessions (which do have a parent) never enter scans. The row counts
 * double as the cache fingerprint (see cache.ts): both subqueries are
 * index-only, so this stays cheap — timestamp columns on message/part are not
 * reliably maintained and reading them means touching every row's overflowed
 * pages.
 */
export function queryGlobalSessions(limit: number): SessionRow[] {
  const conn = openDb();
  const v2 = hasTable("session_v2") && hasTable("session_message");
  const v1 = hasTable("session") && hasTable("message") && hasTable("part");
  if (!v1 && !v2) throw new Error(`Unsupported OpenCode database schema at ${DB_PATH}`);
  const sources: string[] = [];
  if (v1) sources.push(`SELECT s.id, s.time_updated,
    (SELECT count(*) FROM message m WHERE m.session_id = s.id) AS message_count,
    (SELECT count(*) FROM part p WHERE p.session_id = s.id) AS part_count, 1 AS source
    FROM session s WHERE s.parent_id IS NULL
    ${v2 ? "AND NOT EXISTS (SELECT 1 FROM session_v2 v WHERE v.id = s.id)" : ""}`);
  if (v2) sources.push(`SELECT s.id, s.time_updated, 0 AS message_count, 0 AS part_count, 2 AS source
    FROM session_v2 s WHERE s.parent_id IS NULL`);
  return conn
    .prepare(
      `SELECT * FROM (${sources.join(" UNION ALL ")}) ORDER BY time_updated DESC LIMIT ?`,
    )
    .all(limit) as unknown as SessionRow[];
}

/** Change-detection signature for one session's rows (index-only to compute). */
export interface SessionFingerprint {
  messages: number;
  parts: number;
}

/** Read each session from its authoritative schema. V2 projections supersede migrated v1 rows. */
export function querySamples(sessions: readonly SessionRow[]): Map<string, MessageSample[]> {
  const conn = openDb();
  const out = new Map<string, MessageSample[]>();
  const legacy = sessions.filter((session) => session.source === 1).map((session) => session.id);
  const texts = queryTextParts(legacy);
  for (const meta of queryMessageMetas(legacy)) {
    if (meta.role !== "user" && meta.role !== "assistant") continue;
    const text = texts.get(meta.id)?.join("\n");
    if (!text?.trim()) continue;
    const samples = out.get(meta.sessionId) ?? [];
    samples.push({ role: meta.role, providerID: meta.providerID ?? "unknown", modelID: meta.modelID ?? "unknown", created: meta.created, text });
    out.set(meta.sessionId, samples);
  }
  for (const group of chunk(sessions.filter((session) => session.source === 2).map((session) => session.id))) {
    const rows = conn.prepare(`SELECT m.id, m.session_id, m.type, m.data, s.model
      FROM session_message m JOIN session_v2 s ON s.id = m.session_id
      WHERE m.session_id IN (${placeholders(group.length)}) AND m.type IN ('user', 'assistant', 'model-switched')
      ORDER BY m.session_id, m.seq`).all(...group) as Array<{ id: string; session_id: string; type: string; data: string; model: string | null }>;
    const messages = new Map<string, { messages: SessionMessageInfo[]; model?: ModelRef }>();
    for (const row of rows) {
      const entry = messages.get(row.session_id) ?? { messages: [], model: row.model ? JSON.parse(row.model) as ModelRef : undefined };
      entry.messages.push({ ...JSON.parse(row.data), id: row.id, type: row.type } as SessionMessageInfo);
      messages.set(row.session_id, entry);
    }
    for (const [id, entry] of messages) out.set(id, v2Samples(entry.messages, entry.model));
  }
  return out;
}

export interface MessageMeta {
  id: string;
  sessionId: string;
  role: string;
  providerID: string | null;
  modelID: string | null;
  created: number;
}

/**
 * Message metadata (role, attribution, time) for the given sessions.
 *
 * Assistant messages carry top-level providerID/modelID; user messages nest
 * them under $.model instead (same shape the SDK path reads at tui.tsx).
 */
export function queryMessageMetas(ids: readonly string[]): MessageMeta[] {
  const conn = openDb();
  const out: MessageMeta[] = [];
  for (const group of chunk(ids)) {
    const rows = conn
      .prepare(
        `SELECT m.id,
                m.session_id as sessionId,
                json_extract(m.data, '$.role') as role,
                coalesce(json_extract(m.data, '$.providerID'),
                         json_extract(m.data, '$.model.providerID')) as providerID,
                coalesce(json_extract(m.data, '$.modelID'),
                         json_extract(m.data, '$.model.modelID')) as modelID,
                m.time_created as created
         FROM message m
         WHERE m.session_id IN (${placeholders(group.length)})
         ORDER BY m.time_created ASC`,
      )
      .all(...group) as unknown as MessageMeta[];
    out.push(...rows);
  }
  return out;
}

/**
 * Text content per message id, parts joined in insertion order.
 *
 * Text parts cannot be told apart from the rest without parsing `data`, and
 * parsing every part blob costs seconds. Instead, read a 20-byte prefix of
 * each part (cheap: SQLite loads only the head of overflowed values), keep
 * the ones that start `{"type":"text"`, and fetch only those blobs back.
 * On a 200-session scan this reads ~10 MB of text instead of ~280 MB of JSON.
 */
/**
 * Text content per message id, parts joined in insertion order.
 *
 * Text parts cannot be told apart from the rest without parsing `data`, and
 * parsing every part blob costs seconds. Instead, read a short prefix of
 * each part (cheap: SQLite loads only the head of overflowed values), keep
 * the ones that start with the text-part shape, and fetch only those blobs
 * back. On a 200-session scan this reads ~10 MB of text instead of ~280 MB
 * of JSON.
 *
 * Synthetic and ignored parts are skipped so both scan paths count the same
 * messages as the SDK path does.
 */
export function queryTextParts(ids: readonly string[]): Map<string, string[]> {
  const conn = openDb();
  const out = new Map<string, string[]>();
  for (const group of chunk(ids)) {
    // The prefix match can in principle over-match (e.g. a hypothetical type
    // "textX"); the full JSON.parse below re-checks `type === "text"`.
    const candidates = conn
      .prepare(
        `SELECT id FROM part WHERE session_id IN (${placeholders(group.length)}) AND substr(data, 1, ?) = ?`,
      )
      .all(...group, TEXT_PART_PREFIX.length, TEXT_PART_PREFIX) as unknown as { id: string }[];
    for (const batch of chunk(candidates.map((row) => row.id))) {
      const rows = conn
        .prepare(`SELECT message_id, data FROM part WHERE id IN (${placeholders(batch.length)}) ORDER BY rowid ASC`)
        .all(...batch) as unknown as { message_id: string; data: string }[];
      for (const row of rows) {
        let part: { type?: string; text?: string; synthetic?: boolean; ignored?: boolean };
        try {
          part = JSON.parse(row.data);
        } catch {
          continue; // one malformed row must not fail its whole batch
        }
        if (part.type !== "text" || typeof part.text !== "string") continue;
        if (part.synthetic || part.ignored) continue;
        const list = out.get(row.message_id);
        if (list) list.push(part.text);
        else out.set(row.message_id, [part.text]);
      }
    }
  }
  return out;
}
