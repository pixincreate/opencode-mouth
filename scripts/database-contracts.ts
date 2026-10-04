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
  const { toRecord } = await import("../src/aggregate.ts");
  const { loadCachedSession, saveCachedSessions, pruneSessionCache } = await import("../src/cache.ts");
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
  assert.deepEqual(toRecord(samples[0]!), toRecord(legacy[0]!));
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
    const { saveCachedSessions, loadCachedSession, pruneSessionCache } = await import(${JSON.stringify(new URL("../src/cache.ts", import.meta.url).href)});
    const result = [...querySamples(queryGlobalSessions(10))];
    const fp = { messages: 1, parts: 1 };
    saveCachedSessions([{ id: "node-cache", fp, records: [] }]);
    assert.deepEqual(loadCachedSession("node-cache", fp), []);
    pruneSessionCache([]);
    assert.equal(loadCachedSession("node-cache", fp), undefined);
    console.log(JSON.stringify(result));
  `], { encoding: "utf8", env: process.env });
  assert.deepEqual(JSON.parse(nodeResults), [...querySamples(queryGlobalSessions(10))], "Node and Bun must read identical scores and support cache transactions");
  const beforeReads = db.serialize();
  querySamples(queryGlobalSessions(10));
  assert.deepEqual(db.serialize(), beforeReads, "reading sessions must not mutate the source database");

  const fp = { messages: 1, parts: 1 };
  const entries = Array.from({ length: 601 }, (_, i) => ({ id: String(i), fp, records: [toRecord(legacy[0]!)] }));
  saveCachedSessions(entries);
  assert.deepEqual(loadCachedSession("0", fp), entries[0]!.records);
  assert.equal(loadCachedSession("0", { messages: 2, parts: 1 }), undefined);
  assert.equal(loadCachedSession("0", { messages: 1, parts: 2 }), undefined);
  const otherDatabase = execFileSync(process.execPath, ["--eval", `const { loadCachedSession } = await import(${JSON.stringify(new URL("../src/cache.ts", import.meta.url).href)}); console.log(loadCachedSession("0", { messages: 1, parts: 1 }) === undefined);`], {
    encoding: "utf8", env: { ...process.env, OPENCODE_DB: join(root, "other.db") },
  });
  assert.equal(otherDatabase.trim(), "true", "a different database must not reuse cached session scores");
  saveCachedSessions([{ id: "stale", fp, records: entries[0]!.records }]);
  pruneSessionCache(entries.map((entry) => entry.id));
  assert.equal(loadCachedSession("stale", fp), undefined);
  assert.deepEqual(loadCachedSession("600", fp), entries[600]!.records);
  pruneSessionCache([]);
  assert.equal(loadCachedSession("600", fp), undefined);
  console.log("Database contracts passed: v1/v2 scores, roots, limits, empty transcripts, unknown models, read-only behavior, mixed schemas, model switches, text updates, cache identity, invalidation, and pruning.");
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
