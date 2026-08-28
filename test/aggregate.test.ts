import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRoleStats,
  dayKey,
  frictionOf,
  hitsOf,
  modelsOf,
  toRecord,
  type MessageSample,
} from "../src/aggregate.ts";

const at = (day: string): number => new Date(`${day}T12:00:00`).getTime();

const sample = (over: Partial<MessageSample>): MessageSample => ({
  role: "user",
  providerID: "anthropic",
  modelID: "opus",
  created: at("2026-08-20"),
  text: "hi",
  ...over,
});

test("splits totals by role", () => {
  const records = [
    toRecord(sample({ role: "user", text: "fuck" })),
    toRecord(sample({ role: "assistant", text: "damn" })),
  ];
  const user = buildRoleStats(records, { role: "user" });
  const assistant = buildRoleStats(records, { role: "assistant" });
  assert.equal(user.totals.messages, 1);
  assert.equal(user.totals.profanity, 1);
  assert.equal(assistant.totals.messages, 1);
  assert.equal(assistant.totals.profanity, 1);
});

test("groups by model sorted by message count", () => {
  const records = [
    toRecord(sample({ modelID: "big" })),
    toRecord(sample({ modelID: "big" })),
    toRecord(sample({ modelID: "big" })),
    toRecord(sample({ modelID: "small", text: "shit" })),
  ];
  const { byModel } = buildRoleStats(records, { role: "user" });
  assert.equal(byModel.length, 2);
  assert.equal(byModel[0].modelID, "big");
  assert.equal(byModel[0].messages, 3);
  assert.equal(byModel[1].profanity, 1);
});

test("groups by local day", () => {
  const records = [
    toRecord(sample({ created: at("2026-08-19") })),
    toRecord(sample({ created: at("2026-08-20") })),
    toRecord(sample({ created: at("2026-08-20") })),
  ];
  const { byDay } = buildRoleStats(records, { role: "user" });
  assert.deepEqual(
    byDay.map((d) => [d.day, d.messages]),
    [
      ["2026-08-19", 1],
      ["2026-08-20", 2],
    ],
  );
});

test("since filter drops older records", () => {
  const records = [
    toRecord(sample({ created: at("2026-08-01"), text: "fuck" })),
    toRecord(sample({ created: at("2026-08-20"), text: "shit" })),
  ];
  const stats = buildRoleStats(records, { role: "user", since: at("2026-08-10") });
  assert.equal(stats.totals.messages, 1);
  assert.deepEqual(stats.words, [{ word: "shit", count: 1 }]);
});

test("model filter keeps only the selected model", () => {
  const records = [
    toRecord(sample({ modelID: "opus", text: "fuck" })),
    toRecord(sample({ modelID: "haiku", text: "shit" })),
  ];
  const stats = buildRoleStats(records, { role: "user", model: "anthropic/opus" });
  assert.equal(stats.totals.messages, 1);
  assert.equal(stats.byModel.length, 1);
  assert.equal(stats.byModel[0].modelID, "opus");
  assert.deepEqual(stats.words, [{ word: "fuck", count: 1 }]);
});

test("accumulates profanity word frequencies sorted by count", () => {
  const records = [
    toRecord(sample({ text: "shit shit fuck" })),
    toRecord(sample({ text: "SHIT" })),
  ];
  const { words } = buildRoleStats(records, { role: "user" });
  assert.deepEqual(words, [
    { word: "shit", count: 3 },
    { word: "fuck", count: 1 },
  ]);
});

test("modelsOf lists distinct models per role by frequency", () => {
  const records = [
    toRecord(sample({ modelID: "a" })),
    toRecord(sample({ modelID: "b" })),
    toRecord(sample({ modelID: "b" })),
    toRecord(sample({ role: "assistant", modelID: "c" })),
  ];
  assert.deepEqual(modelsOf(records, "user"), [
    { key: "anthropic/b", messages: 2 },
    { key: "anthropic/a", messages: 1 },
  ]);
  assert.deepEqual(modelsOf(records, "assistant"), [{ key: "anthropic/c", messages: 1 }]);
});

test("friction and hits derive from totals", () => {
  const totals = {
    messages: 10,
    chars: 0,
    words: 0,
    yelling: 1,
    profanity: 2,
    anguish: 3,
    negation: 4,
    repetition: 5,
    blame: 6,
  };
  assert.equal(frictionOf(totals), 15);
  assert.equal(hitsOf(totals), 21);
});

test("dayKey uses the local date", () => {
  assert.equal(dayKey(at("2026-08-20")), "2026-08-20");
});
