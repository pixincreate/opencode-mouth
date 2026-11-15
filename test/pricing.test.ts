import test from "node:test";
import assert from "node:assert/strict";
import { effectiveTokenCost, timeBasedMultiplier } from "../src/pricing.ts";

const fallback = { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 };

test("effectiveTokenCost uses dated rates only for exact provider/model matches", () => {
  assert.deepEqual(effectiveTokenCost("deepseek", "deepseek-flash", fallback, 0), {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0,
  });
  assert.deepEqual(effectiveTokenCost("opencode-go", "deepseek-flash", fallback, 0), fallback);
  assert.deepEqual(effectiveTokenCost("deepseek", "deepseek-v4-pro", fallback, 1_789_358_400_000 - 1), {
    input: 1.32,
    output: 3.96,
    cacheRead: 0.044,
    cacheWrite: 0,
  });
  assert.deepEqual(effectiveTokenCost("deepseek", "deepseek-v4-pro", fallback, 1_789_358_400_000), {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0,
  });
  assert.deepEqual(effectiveTokenCost("google-antigravity", "gemini-4-argon", fallback, 1_796_112_000_000 - 1), {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    cacheWrite: 0,
  });
  assert.deepEqual(effectiveTokenCost("google-antigravity", "gemini-4-argon", fallback, 1_796_112_000_000), {
    input: 4,
    output: 20,
    cacheRead: 0.2,
    cacheWrite: 0,
  });
});

test("timeBasedMultiplier applies only exact provider peak windows", () => {
  const peakMonday = 1_794_794_400_000; // 2026-11-16T02:00:00Z
  const offPeakMonday = 1_794_805_200_000; // 2026-11-16T05:00:00Z
  assert.equal(timeBasedMultiplier("deepseek", "deepseek-flash", peakMonday), 1);
  assert.equal(timeBasedMultiplier("deepseek", "deepseek-flash", offPeakMonday), 0.5);
  assert.equal(timeBasedMultiplier("opencode-go", "deepseek-flash", offPeakMonday), 1);
  assert.equal(timeBasedMultiplier("google-antigravity", "gemini-4-argon", offPeakMonday), 1);
});
