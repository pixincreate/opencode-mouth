import test from "node:test";
import assert from "node:assert/strict";
import { classifyModel, mergeModelRows } from "../src/catalog.ts";
import type { FrustrationModelStats } from "../src/stats-db.ts";

test("classifyModel mirrors the DeepSeek taxonomy from upstream PR #14199", () => {
  assert.deepEqual(classifyModel("opencode-zen", "deepseek-v4-flash-free"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.0.0",
  });
  assert.deepEqual(classifyModel("openrouter", "deepseek/deepseek-v4-flash-0731"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.0.0",
  });
  assert.deepEqual(classifyModel("crofai", "deepseek-v4.1-flash"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.1.0",
  });
  assert.deepEqual(classifyModel("deepseek", "deepseek-flash"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.1.0",
  });
  assert.deepEqual(classifyModel("opencode-go", "deepseek-flash"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.1.0",
  });
  assert.deepEqual(classifyModel("deepseek", "deepseek-r1"), { modelClass: "deepseek", family: "r1" });
});

test("classifyModel covers the other catalog classes", () => {
  assert.deepEqual(classifyModel("anthropic", "claude-opus-4-5"), {
    modelClass: "anthropic",
    family: "opus",
    revision: "4.5.0",
  });
  assert.deepEqual(classifyModel("anthropic", "claude-3-5-sonnet-20241022"), {
    modelClass: "anthropic",
    family: "sonnet",
    revision: "3.5.0",
  });
  assert.deepEqual(classifyModel("openai", "gpt-5.2"), {
    modelClass: "openai",
    family: "gpt",
    revision: "5.2.0",
  });
  assert.deepEqual(classifyModel("openai", "o3-mini"), {
    modelClass: "openai",
    family: "o-series",
    revision: "3.0.0",
  });
  assert.deepEqual(classifyModel("openai", "codex-mini"), { modelClass: "openai", family: "codex" });
  assert.deepEqual(classifyModel("openai", "gpt-4"), {
    modelClass: "openai",
    family: "gpt",
    revision: "4.0.0",
  });
  assert.deepEqual(classifyModel("openai", "gpt-4o"), { modelClass: "openai", family: "gpt" });
  assert.deepEqual(classifyModel("openai", "custom-gpt-5.2"), { modelClass: "unknown" });
  assert.deepEqual(classifyModel("google", "gemini-2.5-flash"), {
    modelClass: "gemini",
    family: "flash",
    revision: "2.5.0",
  });
  assert.deepEqual(classifyModel("x-ai", "grok-4"), { modelClass: "xai", family: "grok", revision: "4.0.0" });
  assert.deepEqual(classifyModel("moonshotai", "kimi-k2-thinking"), { modelClass: "kimi", family: "k2-thinking" });
  assert.deepEqual(classifyModel("local", "some-random-model"), { modelClass: "unknown" });
});

const row = (model: string, provider: string, messages = 1): FrustrationModelStats => ({
  key: `${provider}/${model}`,
  model,
  provider,
  firstSeen: 1_000,
  messages,
  judged: 0,
  annoyed: 0,
  atAssistant: 0,
  angry: 0,
});

test("mergeModelRows groups DeepSeek V4 Flash variants across providers", () => {
  const merged = mergeModelRows([
    row("deepseek-v4-flash-free", "opencode-zen"),
    row("deepseek/deepseek-v4-flash-0731", "openrouter"),
    row("deepseek-v4-flash", "cline-pass"),
    row("deepseek-v4-flash-0731", "crofai"),
    row("cline-free/deepseek-v4-flash", "cline-pass"),
    row("deepseek/deepseek-v4-pro", "openrouter"),
    row("deepseek-v4.1-flash", "crofai"),
    row("some-random-model", "local"),
  ]);

  assert.deepEqual(merged.map((entry) => entry.key), [
    "deepseek/flash/4.0.0",
    "deepseek/pro/4.0.0",
    "deepseek/flash/4.1.0",
    "some-random-model",
  ]);
  const flash = merged[0];
  assert.equal(flash.label, "flash 4");
  assert.equal(flash.messages, 5);
  assert.equal(flash.models.length, 5);
  assert.equal(merged[1].label, "pro 4");
  assert.equal(merged[2].label, "flash 4.1");
  assert.equal(merged[3].label, "some-random-model");
  assert.equal(merged[3].modelClass, null);
});

test("mergeModelRows groups unclassified rows by raw model id and sums counts", () => {
  const merged = mergeModelRows([
    row("mystery-model", "provider-a", 2),
    row("mystery-model", "provider-b", 3),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].key, "mystery-model");
  assert.equal(merged[0].label, "mystery-model");
  assert.equal(merged[0].messages, 5);
});

test("mergeModelRows keeps letter-suffixed models apart from their numeric siblings", () => {
  const merged = mergeModelRows([
    row("gpt-4", "openai"),
    row("gpt-4o", "openai"),
    row("custom-gpt-5.2", "openai"),
  ]);
  assert.deepEqual(
    merged.map((entry) => entry.key).sort(),
    ["custom-gpt-5.2", "gpt-4o", "openai/gpt/4.0.0"],
  );
  assert.equal(merged.find((entry) => entry.key === "openai/gpt/4.0.0")?.label, "gpt 4");
});
