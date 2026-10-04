import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const root = mkdtempSync(join(tmpdir(), "mouth-database-"));
process.env.OPENCODE_DB = join(root, "opencode.db");
process.env.MOUTH_INSTALL_STATE_DIR = join(root, "state");
const db = new Database(process.env.OPENCODE_DB);
try {
  const { queryGlobalSessions, querySamples } = await import("../src/db.ts");
  const { isCachedSession, saveCachedSessions, pruneSessionCache } = await import("../src/cache.ts");
  db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,time_updated INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);
    CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,data TEXT);
    INSERT INTO session VALUES('same',NULL,1),('legacy-only',NULL,0);
    INSERT INTO message VALUES('old','same',1,'{"role":"user","model":{"providerID":"p","modelID":"a"}}');
    INSERT INTO part VALUES('old-text','old','same','{"type":"text","text":"damn"}');`);
  const legacy = querySamples(queryGlobalSessions(10)).get("same")!;
  assert.equal(legacy[0]!.text, "damn");
  db.exec("INSERT INTO session VALUES('child','same',999),('empty',NULL,3)");
  assert.deepEqual(queryGlobalSessions(2).map((session) => session.id), ["empty", "same"]);
  assert.equal(querySamples(queryGlobalSessions(1)).get("empty"), undefined);
  db.exec("DELETE FROM session WHERE id IN ('child','empty')");
  db.exec(`INSERT INTO part VALUES
    ('ignored','old','same','{"type":"text","text":"hidden ignored","ignored":true}'),
    ('synthetic','old','same','{"type":"text","text":"hidden synthetic","synthetic":true}'),
    ('non-text','old','same','{"type":"reasoning","text":"hidden reasoning"}'),
    ('malformed','old','same','{"type":"text","text":');`);
  assert.deepEqual(querySamples(queryGlobalSessions(10)).get("same"), legacy);

  db.exec(`CREATE TABLE session_v2(id TEXT PRIMARY KEY,parent_id TEXT,time_updated INTEGER,model TEXT);
    CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT);
    INSERT INTO session_v2 VALUES('same',NULL,2,'{"providerID":"p","id":"c"}');`);
  const insert = db.prepare("INSERT INTO session_message VALUES(?, 'same', ?, ?, 1, 1, ?)");
  const model = (id: string) => ({ providerID: "p", id });
  const add = (id: string, type: string, seq: number, data: object) => insert.run(id, type, seq, JSON.stringify({ time: { created: 1 }, ...data }));
  // Insert in reverse sequence to prove transcript order is independent of row order and timestamp ties.
  add("last", "user", 7, { text: "last prompt", files: [], agents: [], skills: [] });
  add("switch2", "model-switched", 6, { model: model("c"), previous: model("b") });
  add("reply", "assistant", 5, { model: model("b"), agent: "build", content: [
    { type: "reasoning", text: "hidden" }, { type: "text", text: "visible" },
    { type: "tool", name: "shell", id: "t1", state: { status: "completed", input: {}, content: [{ type: "text", text: "hidden tool output" }] } },
  ] });
  add("middle", "user", 4, { text: "middle prompt", files: [], agents: [], skills: [] });
  add("switch1", "model-switched", 3, { model: model("b"), previous: model("a") });
  add("synthetic", "synthetic", 2, { text: "hidden synthetic" });
  add("first", "user", 1, { text: "damn", files: [], agents: [], skills: [] });
  const sessions = queryGlobalSessions(10);
  assert.deepEqual(sessions.map((session) => session.id), ["same", "legacy-only"]);
  const samples = querySamples(sessions).get("same")!;
  assert.deepEqual(samples.map((sample) => [sample.text, sample.modelID]), [["damn", "a"], ["middle prompt", "b"], ["visible", "b"], ["last prompt", "c"]]);
  const withoutId = ({ messageId, ...rest }: { messageId: string }) => rest;
  assert.deepEqual(withoutId(samples[0]!), withoutId(legacy[0]!));
  db.prepare("UPDATE session_message SET data=json_set(data,'$.content[1].text','changed text') WHERE id='reply'").run();
  assert.equal(querySamples(queryGlobalSessions(10)).get("same")![2]!.text, "changed text");
  db.exec(`INSERT INTO session_v2 VALUES('v2-child','same',999,NULL),('v2-empty',NULL,3,NULL)`);
  assert.deepEqual(queryGlobalSessions(2).map((session) => session.id), ["v2-empty", "same"]);
  assert.equal(querySamples(queryGlobalSessions(1)).get("v2-empty"), undefined);
  add("blank", "user", 8, { text: " \n\t", files: [], agents: [], skills: [] });
  add("empty-reply", "assistant", 9, { model: model("c"), agent: "build", content: [{ type: "reasoning", text: "not scored" }] });
  assert.equal(querySamples(queryGlobalSessions(10)).get("same")!.length, 4);
  const noModel = db.prepare("INSERT INTO session_message VALUES(?, 'v2-empty', 'user', 1, 1, 1, ?)");
  noModel.run("unknown", JSON.stringify({ text: "prompt without a recorded model", time: { created: 1 } }));
  const unattributed = querySamples(queryGlobalSessions(10)).get("v2-empty")![0]!;
  assert.equal(unattributed.modelID, "unknown");
  assert.equal(unattributed.providerID, "unknown");
  const nodeResults = execFileSync("node", ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    const { queryGlobalSessions, querySamples } = await import(${JSON.stringify(new URL("../src/db.ts", import.meta.url).href)});
    const { isCachedSession, saveCachedSessions, pruneSessionCache } = await import(${JSON.stringify(new URL("../src/cache.ts", import.meta.url).href)});
    const result = [...querySamples(queryGlobalSessions(10))];
    const fp = { messages: 1, parts: 1 };
    saveCachedSessions([{ id: "node-cache", fp }]);
    assert.equal(isCachedSession("node-cache", fp), true);
    assert.equal(isCachedSession("node-cache", { messages: 2, parts: 1 }), false);
    pruneSessionCache([]);
    assert.equal(isCachedSession("node-cache", fp), false);
    console.log(JSON.stringify(result));
  `], { encoding: "utf8", env: process.env });
  assert.deepEqual(JSON.parse(nodeResults), [...querySamples(queryGlobalSessions(10))], "Node and Bun must read identical scores and support cache transactions");
  const beforeReads = db.serialize();
  querySamples(queryGlobalSessions(10));
  assert.deepEqual(db.serialize(), beforeReads, "reading sessions must not mutate the source database");

  const fp = { messages: 1, parts: 1 };
  const entries = Array.from({ length: 601 }, (_, i) => ({ id: String(i), fp }));
  saveCachedSessions(entries);
  assert.equal(isCachedSession("0", fp), true);
  assert.equal(isCachedSession("0", { messages: 2, parts: 1 }), false);
  assert.equal(isCachedSession("0", { messages: 1, parts: 2 }), false);
  const otherDatabase = execFileSync(process.execPath, ["--eval", `const { isCachedSession } = await import(${JSON.stringify(new URL("../src/cache.ts", import.meta.url).href)}); console.log(isCachedSession("0", { messages: 1, parts: 1 }) === false);`], {
    encoding: "utf8", env: { ...process.env, OPENCODE_DB: join(root, "other.db") },
  });
  assert.equal(otherDatabase.trim(), "true", "a different database must not reuse cached session markers");
  saveCachedSessions([{ id: "stale", fp }]);
  pruneSessionCache(entries.map((entry) => entry.id));
  assert.equal(isCachedSession("stale", fp), false);
  assert.equal(isCachedSession("600", fp), true);
  pruneSessionCache([]);
  assert.equal(isCachedSession("600", fp), false);

  const { saveUserMessages, saveVerdict, frustrationOverall, pendingProse } = await import("../src/stats-db.ts");
  saveUserMessages([
    { sessionFile: "s1", entryId: "m1", folder: "", timestamp: 1, model: "a", provider: "p", chars: 10, words: 3, yelling: 0, profanity: 0, anguish: 0, negation: 1, repetition: 0, blame: 0, prose: "nope, wrong", proseHash: "h1" },
    { sessionFile: "s1", entryId: "m2", folder: "", timestamp: 2, model: "a", provider: "p", chars: 10, words: 3, yelling: 1, profanity: 1, anguish: 0, negation: 1, repetition: 0, blame: 0, prose: "why did you break it", proseHash: "h2" },
  ]);
  assert.deepEqual(frustrationOverall(), { messages: 2, judged: 0, annoyed: 2, atAssistant: 2, angry: 1 });
  assert.deepEqual(pendingProse().map((entry) => entry.hash).sort(), ["h1", "h2"]);
  saveVerdict({ proseHash: "h1", pAnnoyed: 1, pAngry: 0, target: "assistant", judge: "p/a", judgedAt: 3 });
  assert.deepEqual(frustrationOverall(), { messages: 2, judged: 1, annoyed: 2, atAssistant: 2, angry: 1 });
  assert.deepEqual(pendingProse().map((entry) => entry.hash), ["h2"]);
  console.log("Database contracts passed: v1/v2 scores, roots, limits, empty transcripts, unknown models, read-only behavior, mixed schemas, model switches, text updates, cache markers, and stats ingestion.");
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
