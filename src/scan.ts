/**
 * Session scan and ingestion.
 *
 * Reads sessions through the host (project/directory scope) or directly from
 * the OpenCode database (global scope) and writes one stats row per user
 * message into Mouth's stats database. The global scan skips sessions whose
 * row counts already match a stored marker, so unchanged sessions are neither
 * re-read nor re-ingested.
 */
import { isCachedSession, pruneSessionCache, saveCachedSessions, type CacheEntry } from "./cache.ts";
import { queryGlobalSessions, querySamples, type SessionFingerprint, type SessionRow } from "./db.ts";
import type { Host } from "./host.ts";
import { proseHash } from "./judge.ts";
import type { MessageSample } from "./messages.ts";
import { analyzeUserMessage, judgeProse } from "./metrics.ts";
import { saveUserMessages, type UserMessageRow } from "./stats-db.ts";
import type { MouthOptions } from "./ui.tsx";

export interface ScanResult {
  sessions: number;
  failures: number;
  loadedAt: number;
  /** Directory or project the scan covered; absent for global database scans. */
  target?: string;
}

export type LoadState =
  | { status: "idle" }
  | { status: "loading"; done: number; total: number }
  | ({ status: "ready" } & ScanResult)
  | { status: "error"; message: string };

/** Let the TUI render before the next synchronous batch of work. */
export const yieldToUI = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const FETCH_CONCURRENCY = 6;
/**
 * Sessions processed between progress paints. Small enough that the TUI
 * repaints the progress bar between batches, large enough to amortize queries.
 */
const SCAN_BATCH = 25;
/** Cache-check loop granularity: sessions per yield while matching fingerprints. */
const CACHE_CHECK_CHUNK = 50;

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

const modelOf = (value: string): string | null => (value === "unknown" ? null : value);

/** Stats rows for the user messages in one session's samples. */
function rowsOf(sessionId: string, folder: string, samples: readonly MessageSample[]): UserMessageRow[] {
  const rows: UserMessageRow[] = [];
  for (const sample of samples) {
    if (sample.role !== "user") continue;
    const metrics = analyzeUserMessage(sample.text);
    const prose = judgeProse(sample.text);
    rows.push({
      sessionFile: sessionId,
      entryId: sample.messageId,
      folder,
      timestamp: sample.created,
      model: modelOf(sample.modelID),
      provider: modelOf(sample.providerID),
      chars: metrics.chars,
      words: metrics.words,
      yelling: metrics.yelling,
      profanity: metrics.profanity,
      anguish: metrics.anguish,
      negation: metrics.negation,
      repetition: metrics.repetition,
      blame: metrics.blame,
      prose,
      proseHash: prose ? proseHash(prose) : "",
    });
  }
  return rows;
}

export async function scan(
  host: Host,
  opts: MouthOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult> {
  if (opts.scope === "global") return scanGlobal(opts, onProgress);

  const { target, list } = await host.sessions(opts);
  onProgress(0, list.length);
  let done = 0;
  let failures = 0;
  await mapPool(list, FETCH_CONCURRENCY, async (session) => {
    try {
      saveUserMessages(rowsOf(session.id, target, await session.samples()));
    } catch {
      failures += 1;
    }
    done += 1;
    onProgress(done, list.length);
  });
  return { sessions: list.length, failures, loadedAt: Date.now(), target };
}

async function scanGlobal(
  opts: MouthOptions,
  onProgress: (done: number, total: number) => void,
): Promise<ScanResult> {
  await yieldToUI();
  const sessionList = queryGlobalSessions(opts.sessionLimit);
  onProgress(0, sessionList.length);

  const stale: Array<{ session: SessionRow; fp: SessionFingerprint }> = [];
  for (let start = 0; start < sessionList.length; start += CACHE_CHECK_CHUNK) {
    if (start > 0) await yieldToUI();
    for (const session of sessionList.slice(start, start + CACHE_CHECK_CHUNK)) {
      const fp = { messages: session.message_count, parts: session.part_count };
      // V2 streams text into existing rows. Row counts cannot invalidate those.
      if (session.source === 1 && isCachedSession(session.id, fp)) continue;
      stale.push({ session, fp });
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
      const markers: CacheEntry[] = [];
      for (const { session, fp } of batch) {
        try {
          saveUserMessages(rowsOf(session.id, "", samples.get(session.id) ?? []));
          if (session.source === 1) markers.push({ id: session.id, fp });
        } catch {
          failures += 1;
        }
      }
      saveCachedSessions(markers);
    } catch {
      failures += batch.length;
    }
    onProgress(cachedCount + Math.min(start + SCAN_BATCH, stale.length), sessionList.length);
  }
  pruneSessionCache(sessionList.map((session) => session.id));
  return { sessions: sessionList.length, failures, loadedAt: Date.now() };
}
