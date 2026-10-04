import test from "node:test";
import assert from "node:assert/strict";
import type { MetricRecord } from "../src/aggregate.ts";
import type { BehaviorMetrics } from "../src/metrics.ts";
import { buildFrustrationByDay, buildFrustrationStats, classifyRecord, isMostlyRegex } from "../src/frustration.ts";
import type { FrustrationVerdict } from "../src/judge.ts";

const empty: BehaviorMetrics = {
  chars: 10,
  words: 2,
  yelling: 0,
  profanity: 0,
  profanityWords: {},
  anguish: 0,
  negation: 0,
  repetition: 0,
  blame: 0,
};

const record = (overrides: Partial<MetricRecord> = {}, metrics: Partial<BehaviorMetrics> = {}): MetricRecord => ({
  role: "user",
  providerID: "prov",
  modelID: "model",
  created: 1_000,
  proseHash: "hash",
  metrics: { ...empty, ...metrics },
  ...overrides,
});

const verdict = (overrides: Partial<FrustrationVerdict> = {}): FrustrationVerdict => ({
  proseHash: "hash",
  pAnnoyed: 1,
  pAngry: 0,
  target: "assistant",
  judge: "test/judge",
  judgedAt: 1,
  ...overrides,
});

test("classifyRecord falls back to regex signals without a verdict", () => {
  assert.deepEqual(classifyRecord(record({}, { negation: 1 }), undefined), {
    judged: false,
    annoyed: true,
    atAssistant: true,
    angry: false,
  });
  assert.equal(classifyRecord(record({}, { blame: 1, profanity: 1 }), undefined).angry, true);
  assert.equal(classifyRecord(record({}, { repetition: 1, yelling: 1 }), undefined).angry, true);
  assert.deepEqual(classifyRecord(record({}, { anguish: 1 }), undefined), {
    judged: false,
    annoyed: true,
    atAssistant: false,
    angry: false,
  });
  assert.deepEqual(classifyRecord(record(), undefined), {
    judged: false,
    annoyed: false,
    atAssistant: false,
    angry: false,
  });
});

test("classifyRecord uses cached verdicts when present", () => {
  assert.deepEqual(classifyRecord(record(), verdict({ pAnnoyed: 0.5 })), {
    judged: true,
    annoyed: true,
    atAssistant: true,
    angry: false,
  });
  assert.deepEqual(classifyRecord(record(), verdict({ pAnnoyed: 0.49 })), {
    judged: true,
    annoyed: false,
    atAssistant: false,
    angry: false,
  });
  assert.deepEqual(classifyRecord(record(), verdict({ target: "other" })), {
    judged: true,
    annoyed: true,
    atAssistant: false,
    angry: false,
  });
  assert.equal(classifyRecord(record(), verdict({ pAngry: 0.5 })).angry, true);
});

test("buildFrustrationStats tallies overall and per model", () => {
  const records = [
    record({ created: 2_000, modelID: "b" }, { negation: 1 }),
    record({ created: 1_000, providerID: "other", modelID: "a" }),
    record({ created: 500, providerID: "unknown", modelID: "unknown" }, { profanity: 1 }),
  ];
  const stats = buildFrustrationStats(records, new Map(), { role: "user" });
  assert.equal(stats.overall.messages, 3);
  assert.equal(stats.overall.annoyed, 2);
  assert.equal(stats.overall.atAssistant, 1);
  assert.deepEqual(
    stats.byModel.map((row) => row.key),
    ["other/a", "prov/b"],
  );
  assert.equal(stats.byModel[1].atAssistant, 1);
});

test("buildFrustrationStats ignores records without prose or non-user roles", () => {
  const stats = buildFrustrationStats([record({ proseHash: undefined }), record({ role: "assistant" })], new Map(), {
    role: "user",
  });
  assert.equal(stats.overall.messages, 0);
  assert.deepEqual(stats.byModel, []);
});

test("buildFrustrationByDay groups ascending by local day", () => {
  const day1 = new Date(2026, 0, 2, 12).getTime();
  const day2 = new Date(2026, 0, 3, 12).getTime();
  const days = buildFrustrationByDay([record({ created: day2 }), record({ created: day1 })], new Map(), {
    role: "user",
  });
  assert.deepEqual(
    days.map((day) => day.day),
    ["2026-01-02", "2026-01-03"],
  );
  assert.equal(days[0].messages, 1);
});

test("isMostlyRegex flags rows below the judged share", () => {
  assert.equal(isMostlyRegex({ messages: 4, judged: 1, annoyed: 0, atAssistant: 0, angry: 0 }), true);
  assert.equal(isMostlyRegex({ messages: 4, judged: 2, annoyed: 0, atAssistant: 0, angry: 0 }), false);
  assert.equal(isMostlyRegex({ messages: 0, judged: 0, annoyed: 0, atAssistant: 0, angry: 0 }), false);
});
