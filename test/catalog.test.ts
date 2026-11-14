import test from "node:test";
import assert from "node:assert/strict";
import { AmbiguousIdentityError, classifyModel, mergeModelRows, revisionAtLeast } from "../src/catalog.ts";
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
  assert.deepEqual(classifyModel("openai", "gpt-image-1"), {
    modelClass: "openai",
    family: "gpt-image",
    revision: "1.0.0",
  });
  assert.deepEqual(classifyModel("openai", "chatgpt-image-latest"), {
    modelClass: "openai",
    family: "gpt-image",
  });
  assert.deepEqual(classifyModel("openai", "custom-gpt-5.2"), { modelClass: "unknown" });
  assert.deepEqual(classifyModel("google", "gemini-2.5-flash"), {
    modelClass: "gemini",
    family: "flash",
    revision: "2.5.0",
  });
  assert.deepEqual(classifyModel("x-ai", "grok-4"), { modelClass: "xai", family: "grok", revision: "4.0.0" });
  assert.deepEqual(classifyModel("moonshotai", "kimi-k2-thinking"), {
    modelClass: "kimi",
    family: "k2",
    logicalId: "kimi-k2",
    thinkingVariant: true,
  });
  assert.deepEqual(classifyModel("kimi-code", "k3.1-pro"), {
    modelClass: "kimi",
    family: "k3",
    revision: "3.1.0",
  });
  assert.deepEqual(classifyModel("moonshotai", "kimi-k3.1-pro-highspeed"), {
    modelClass: "kimi",
    family: "k3",
    revision: "3.1.0",
  });
  assert.deepEqual(classifyModel("sambanova", "Meta-Llama-3.1-8B"), {
    modelClass: "meta",
    family: "llama",
  });
  assert.deepEqual(classifyModel("meta", "muse-wonder-1"), {
    modelClass: "meta",
    family: "muse-wonder",
    revision: "1.0.0",
  });
  assert.deepEqual(classifyModel("meta", "muse-ember-2.1"), {
    modelClass: "meta",
    family: "muse-ember",
    revision: "2.1.0",
  });
  assert.deepEqual(classifyModel("openai", "gpt-oss-120b"), { modelClass: "gpt-oss", family: "120b" });
  assert.deepEqual(classifyModel("google", "gemma-3-27b"), {
    modelClass: "gemma",
    revision: "3.0.0",
  });
  assert.deepEqual(classifyModel("amazon", "nova-pro"), { modelClass: "amazon", family: "nova" });
  assert.deepEqual(classifyModel("cohere", "command-r-plus"), { modelClass: "cohere", family: "command" });
  assert.deepEqual(classifyModel("stepfun", "step-3"), { modelClass: "stepfun", family: "step" });
  assert.deepEqual(classifyModel("xiaomi", "mimo-v2-5"), { modelClass: "mimo", family: "v2" });
  assert.deepEqual(classifyModel("ai21", "jamba-1.5"), { modelClass: "ai21", family: "jamba" });
  assert.deepEqual(classifyModel("baidu", "ernie-4.5"), { modelClass: "baidu", family: "ernie" });
  assert.deepEqual(classifyModel("bytedance", "doubao-pro"), { modelClass: "bytedance", family: "doubao" });
  assert.deepEqual(classifyModel("glm", "glm-4.6-thinking"), {
    modelClass: "glm",
    revision: "4.6.0",
    logicalId: "glm-4.6",
    thinkingVariant: true,
  });
  assert.deepEqual(classifyModel("openai", "qwen3.6-max"), {
    modelClass: "qwen",
    revision: "3.6.0",
  });
  assert.deepEqual(classifyModel("cursor", "gpt-5.6-luna-high"), {
    modelClass: "openai",
    family: "gpt",
    revision: "5.6.0",
    logicalId: "gpt-5.6-luna",
    effort: "high",
  });
  assert.deepEqual(classifyModel("local", "some-random-model"), { modelClass: "unknown" });
});

test("classifyModel applies the reviewed upstream overrides", () => {
  assert.deepEqual(classifyModel("opencode-zen", "big-pickle"), { modelClass: "deepseek" });
  assert.deepEqual(classifyModel("umans", "umans-deepseek-v4-flash-0731"), {
    modelClass: "deepseek",
    family: "flash",
    revision: "4.0.0",
  });
  assert.deepEqual(classifyModel("nanogpt", "Gemma-4-31B-Claude-4.6-Opus-Reasoning-Distilled"), {
    modelClass: "anthropic",
    family: "opus",
    revision: "4.6.0",
  });
  assert.deepEqual(classifyModel("yolo-auto", "yolo"), { modelClass: "qwen", revision: "3.8.0" });
  assert.deepEqual(classifyModel("prismml", "bonsai-27b"), { modelClass: "qwen", revision: "3.6.0" });
  assert.deepEqual(classifyModel("abliteration", "abliterated-model-large-v2"), {
    modelClass: "glm",
    revision: "5.3.0",
  });
  assert.deepEqual(classifyModel("vercel-ai-gateway", "deepseek-v3.2-thinking"), {
    modelClass: "deepseek",
    family: "v3",
    revision: "3.2.0",
    logicalId: "deepseek/deepseek-v3.2-thinking",
  });
  assert.deepEqual(classifyModel("kilo", "qwq-32b"), {
    modelClass: "qwen",
    family: "qwq",
    logicalId: "qwen/qwq-32b",
  });
});

test("expiring upstream aliases stop applying after their deadline", () => {
  assert.deepEqual(classifyModel("openai", "gpt-daybreak-blue-latest", { observedAtMs: 1_700_000_000_000 }), {
    modelClass: "openai",
    family: "gpt",
    revision: "5.6.0",
  });
  assert.deepEqual(classifyModel("openai", "gpt-daybreak-blue-latest", { observedAtMs: 1_800_000_000_000 }), {
    modelClass: "openai",
    family: "gpt",
  });
});

test("classifyModel matches bounded namespaces and upstream family aliases", () => {
  assert.deepEqual(classifyModel("sambanova", "us.xai.grok-4.6"), {
    modelClass: "xai",
    family: "grok",
    revision: "4.6.0",
  });
  assert.deepEqual(classifyModel("moonshotai", "kimi-k2p6"), {
    modelClass: "kimi",
    family: "k2.6",
  });
  assert.deepEqual(classifyModel("alibaba", "qwen3-next-80b"), {
    modelClass: "qwen",
    family: "next",
    revision: "3.0.0",
  });
  assert.deepEqual(classifyModel("moonshotai", "kimi-k2-7-code"), {
    modelClass: "kimi",
    family: "k2.7-code",
  });
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
  assert.equal(merged[3].modelClass, "unknown");
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

test("mergeModelRows groups the OpenAI image, Kimi K3.1, and Meta Muse identities", () => {
  const merged = mergeModelRows([
    row("kimi-k3.1-pro", "moonshotai"),
    row("k3.1-pro", "kimi-code"),
    row("gpt-image-1", "openai", 2),
    row("gpt-image-1", "azure", 3),
    row("muse-wonder-1", "meta"),
    row("muse-ember-2.1", "meta"),
    row("Meta-Llama-3.1-8B", "sambanova"),
  ]);

  assert.deepEqual(merged.map((entry) => entry.key), [
    "kimi/k3/3.1.0",
    "meta/muse-wonder/1.0.0",
    "meta/muse-ember/2.1.0",
    "openai/gpt-image/1.0.0",
    "Meta-Llama-3.1-8B",
  ]);
  assert.deepEqual(merged.map((entry) => entry.label), [
    "k3 3.1",
    "muse-wonder 1",
    "muse-ember 2.1",
    "gpt-image 1",
    "Meta-Llama-3.1-8B",
  ]);
  assert.deepEqual(merged[0].models, ["kimi-k3.1-pro", "k3.1-pro"]);
  assert.equal(merged[0].messages, 2);
  assert.equal(merged[3].messages, 5);
  assert.equal(merged[4].modelClass, "meta");
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

test("mergeModelRows folds reviewed aliases into their inferred identity", () => {
  const merged = mergeModelRows([
    row("umans-deepseek-v4-flash-0731", "umans"),
    row("deepseek/deepseek-v4-flash-0731", "openrouter"),
    row("big-pickle", "opencode-zen"),
  ]);
  assert.deepEqual(merged.map((entry) => entry.key), [
    "deepseek/flash/4.0.0",
    "big-pickle",
  ]);
  assert.equal(merged[0].messages, 2);
  assert.deepEqual(merged[0].models, [
    "umans-deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-flash-0731",
  ]);
  assert.equal(merged[1].modelClass, "deepseek");
});

test("revisionAtLeast compares parsed revisions", () => {
  assert.equal(revisionAtLeast(undefined, "3.0.0"), false);
  assert.equal(revisionAtLeast("3.0.0", "3.1.0"), false);
  assert.equal(revisionAtLeast("3.1.0", "3.1.0"), true);
  assert.equal(revisionAtLeast("4.0.0", "3.1.0"), true);
});

test("AmbiguousIdentityError reports the tied identities", () => {
  const error = new AmbiguousIdentityError("kimi-k2.5-kimi-k2.6", "k2.5", "k2.6", "family");
  assert.equal(error.name, "AmbiguousIdentityError");
  assert.equal(error.message, "ambiguous family for `kimi-k2.5-kimi-k2.6`: `k2.5` and `k2.6` tie");
});

test("strict classification rejects tied families", () => {
  assert.throws(
    () => classifyModel("moonshotai", "kimi-k2.5-kimi-k2.6"),
    (error: unknown) => error instanceof AmbiguousIdentityError && error.message.includes("ambiguous family"),
  );
  assert.deepEqual(classifyModel("moonshotai", "kimi-k2.5-kimi-k2.6", { lenient: true }), { modelClass: "kimi" });
});

test("classifyModel reports the cursor lane logical id and effort", () => {
  assert.deepEqual(classifyModel("cursor", "gpt-5.6-luna-high-fast"), {
    modelClass: "openai",
    family: "gpt",
    revision: "5.6.0",
    logicalId: "gpt-5.6-luna-fast",
    effort: "high",
  });
});

test("expiring aliases stay active when no observation time is supplied", () => {
  assert.deepEqual(classifyModel("openai", "gpt-daybreak-blue-latest"), {
    modelClass: "openai",
    family: "gpt",
    revision: "5.6.0",
  });
});
