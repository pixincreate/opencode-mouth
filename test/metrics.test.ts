import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeAssistantMessage, analyzeUserMessage } from "../src/metrics.ts";

test("counts profanity with word boundaries, case-insensitive", () => {
  const m = analyzeUserMessage("what the FUCK is this shit");
  assert.equal(m.profanity, 2);
  assert.deepEqual(m.profanityWords, { fuck: 1, shit: 1 });
});

test("does not match profanity inside larger words", () => {
  const m = analyzeUserMessage("the class Shitake is fine");
  assert.equal(m.profanity, 0);
});

test("empty input scores zero everywhere", () => {
  const m = analyzeUserMessage("   ");
  assert.equal(m.chars, 0);
  assert.equal(m.words, 0);
  assert.equal(m.profanity, 0);
});

test("counts yelling sentences with multiple caps runs", () => {
  const m = analyzeUserMessage("WHAT THE HELL IS THIS");
  assert.equal(m.yelling, 1);
});

test("a lone acronym is not yelling", () => {
  const m = analyzeUserMessage("use JSON here");
  assert.equal(m.yelling, 0);
});

test("counts anguish interjections and drama runs", () => {
  const m = analyzeUserMessage("noooo!!! why did it break");
  assert.ok(m.anguish >= 2);
});

test("counts corrective negation at message start", () => {
  const m = analyzeUserMessage("nope, that broke it");
  assert.equal(m.negation, 1);
});

test("determiner no does not count as negation", () => {
  const m = analyzeUserMessage("no extensions to the page");
  assert.equal(m.negation, 0);
});

test("counts repetition and blame signals", () => {
  const m = analyzeUserMessage("like i said, you didn't fix it. still doesnt work");
  assert.equal(m.repetition, 2);
  assert.equal(m.blame, 1);
});

test("code blocks do not contribute profanity", () => {
  const m = analyzeUserMessage("run this\n```\nconst shit = 'fuck';\n```");
  assert.equal(m.profanity, 0);
});

test("long formatted user prompts score zero emotional signals but keep profanity", () => {
  const lines = ["fix the damn bug", "then run the tests", "you always break the docs", "then commit"];
  const m = analyzeUserMessage(lines.join("\n"));
  assert.equal(m.profanity, 1);
  assert.deepEqual(m.profanityWords, { damn: 1 });
  assert.equal(m.blame, 0);
  assert.equal(m.yelling, 0);
  assert.ok(m.words > 0);
});

test("profanity in a long prompt is counted per word", () => {
  const lines = [
    "the parser is retarded, rewrite it",
    "keep the public api stable",
    "add tests for the retard edge case",
    "do not touch the config",
  ];
  const m = analyzeUserMessage(lines.join("\n"));
  assert.equal(m.profanity, 2);
  assert.deepEqual(m.profanityWords, { retard: 1, retarded: 1 });
});

test("assistant messages count profanity without the prose-length guard", () => {
  const lines = [
    "The damn cache was stale.",
    "I cleared it and re-ran the build.",
    "All twelve tests pass now.",
    "Holy crap that took a while.",
  ];
  const m = analyzeAssistantMessage(lines.join("\n"));
  assert.equal(m.profanity, 2);
  assert.deepEqual(m.profanityWords, { crap: 1, damn: 1 });
});

test("assistant messages never score frustration signals", () => {
  const m = analyzeAssistantMessage("nope, you didn't run it. like i said, still doesnt work!!!");
  assert.equal(m.negation, 0);
  assert.equal(m.repetition, 0);
  assert.equal(m.blame, 0);
  assert.equal(m.anguish, 0);
});

test("assistant code blocks and inline code are ignored", () => {
  const m = analyzeAssistantMessage("Use `damn_flag` here:\n```\n// this shit works\n```\nDone.");
  assert.equal(m.profanity, 0);
});
