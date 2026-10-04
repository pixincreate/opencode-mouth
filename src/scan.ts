/**
 * Session scan pipeline shared by the behavior and frustration dashboards.
 *
 * Project/directory scope fetches samples through the connected server; global
 * scope reads OpenCode's SQLite database directly and caches per-session
 * records under row-count fingerprints. Both paths also collect the stripped
 * user prose (see judge.ts) and persist it, so the frustration dashboard can
 * judge cached and global sessions without rescanning, and load the cached
 * judge verdicts for the scanned messages.
 */
import { proseEntryOf, toRecord, type MessageSample, type MetricRecord } from "./aggregate.ts";
import { loadCachedSession, pruneSessionCache, saveCachedSessions, type CacheEntry } from "./cache.ts";
import { queryGlobalSessions, querySamples, type SessionFingerprint, type SessionRow } from "./db.ts";
import type { Host } from "./host.ts";
import type { FrustrationVerdict, PendingProse } from "./judge.ts";
import type { MouthOptions } from "./ui.tsx";
import { loadVerdicts, saveProse } from "./verdicts.ts";

const FETCH_CONCURRENCY = 6;

/**
 * Sessions processed between progress paints. Small enough that the TUI
 * repaints the progress bar between batches, large enough to amortize the queries.
 */
const SCAN_BATCH = 25;

/** Cache-check loop granularity: sessions per yield while matching fingerprints. */
const CACHE_CHECK_CHUNK = 50;

export interface ScanResult {
  records: MetricRecord[];
  sessions: number;
  failures: number;
  loadedAt: number;
  /** Directory or project the scan covered; absent for global database scans. */
  target?: string;
  /** Unique stripped prose from user messages, keyed by hash. */
  prose: PendingProse[];
  /** Cached judge verdicts for the scanned prose. */
  verdicts: Map<string, FrustrationVerdict>;
}

export type LoadState =
  | { status: "idle" }
  | { status: "loading"; done: number; total: number }
  | ({ status: "ready" } & ScanResult)
  | { status: "error"; message: string };

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

/** Let the TUI render before the next synchronous batch of work. */
export const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function collectProse(samples: readonly MessageSample[], into: Map<string, PendingProse>): void {
  for (const sample of samples) {
    const entry = proseEntryOf(sample);
    if (entry) into.set(entry.hash, entry);
  }
}

/** Persist collected prose and load the verdicts already cached for it. */
function finish(
  records: MetricRecord[],
  prose: Map<string, PendingProse>,
  sessions: number,
  failures: number,
  target?: string,
): ScanResult {
  const entries = [...prose.values()];
  saveProse(entries);
  const verdicts = loadVerdicts(entries.map((entry) => entry.hash));
  return { records, sessions, failures, loadedAt: Date.now(), target, prose: entries, verdicts };
}

export async function scan(
  host: Host,
  opts: MouthOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult> {
  // Global scope: read directly from the SQLite database
  if (opts.scope === "global") {
    return scanGlobal(opts, onProgress);
  }

  // Project/directory scope: use the connected server
  const { target, list } = await host.sessions(opts);
  onProgress(0, list.length);

  const records: MetricRecord[] = [];
  const prose = new Map<string, PendingProse>();
  let done = 0;
  let failures = 0;

  await mapPool(list, FETCH_CONCURRENCY, async (session) => {
    try {
      const samples = await session.samples();
      records.push(...samples.map(toRecord));
      collectProse(samples, prose);
    } catch {
      failures += 1;
    }
    done += 1;
    onProgress(done, list.length);
  });

  return finish(records, prose, list.length, failures, target);
}

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
  const prose = new Map<string, PendingProse>();
  const toSave: CacheEntry[] = [];
  const stale: Array<{ session: SessionRow; fp: SessionFingerprint }> = [];
  for (let start = 0; start < sessionList.length; start += CACHE_CHECK_CHUNK) {
    if (start > 0) await yieldToUI();
    for (const session of sessionList.slice(start, start + CACHE_CHECK_CHUNK)) {
      const fp = { messages: session.message_count, parts: session.part_count };
      // V2 streams text into existing rows. Row counts cannot invalidate those scores.
      const cached = session.source === 1 ? loadCachedSession(session.id, fp) : undefined;
      if (cached) {
        records.push(...cached.records);
        for (const entry of cached.prose) prose.set(entry.hash, entry);
      } else {
        stale.push({ session, fp });
      }
    }
  }
  const cachedCount = sessionList.length - stale.length;
  onProgress(cachedCount, sessionList.length);

  let failures = 0;
  for (let start = 0; start < stale.length; start += SCAN_BATCH) {
    await yieldToUI();
    const batch = stale.slice(start, start + SCAN_BATCH);
    try {
      const samples = querySamples(batch.map((entry) => entry.session));
      for (const { session, fp } of batch) {
        try {
          const sessionSamples = samples.get(session.id) ?? [];
          const sessionRecords = sessionSamples.map(toRecord);
          const sessionProse = new Map<string, PendingProse>();
          collectProse(sessionSamples, sessionProse);
          if (session.source === 1) {
            toSave.push({ id: session.id, fp, records: sessionRecords, prose: [...sessionProse.values()] });
          }
          records.push(...sessionRecords);
          for (const entry of sessionProse.values()) prose.set(entry.hash, entry);
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

  return finish(records, prose, sessionList.length, failures);
}
