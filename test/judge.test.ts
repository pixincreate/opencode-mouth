import test from "node:test";
import assert from "node:assert/strict";
import {
  estimateJudgeRun,
  parseJudgeResponse,
  proseHash,
  runJudge,
  type FrustrationVerdict,
  type JudgeModel,
  type PendingProse,
} from "../src/judge.ts";

const model: JudgeModel = { providerID: "test", modelID: "judge", name: "Judge", inputCost: 1, outputCost: 2 };

test("proseHash matches known SHA-256 vectors", () => {
  assert.equal(proseHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(proseHash(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("parseJudgeResponse accepts plain, fenced and embedded JSON", () => {
  assert.deepEqual(parseJudgeResponse('{"annoyed":2,"target":"assistant"}'), { annoyed: 2, target: "assistant" });
  assert.deepEqual(parseJudgeResponse('```json\n{"annoyed":3,"target":"other"}\n```'), { annoyed: 3, target: "other" });
  assert.deepEqual(parseJudgeResponse('Sure: {"annoyed":0,"target":"none"} done'), { annoyed: 0, target: "none" });
});

test("parseJudgeResponse rejects invalid answers", () => {
  assert.equal(parseJudgeResponse("no json here"), undefined);
  assert.equal(parseJudgeResponse('{"annoyed":9,"target":"assistant"}'), undefined);
  assert.equal(parseJudgeResponse('{"annoyed":2,"target":"model"}'), undefined);
  assert.equal(parseJudgeResponse('{"target":"assistant"}'), undefined);
});

test("estimateJudgeRun follows the upstream cost model", () => {
  const pending: PendingProse[] = [{ hash: "a", prose: "x".repeat(59) }];
  const estimate = estimateJudgeRun(pending, model);
  assert.equal(estimate.messages, 1);
  assert.equal(estimate.chars, 59);
  assert.equal(estimate.inputTokens, 561 + 10);
  assert.equal(estimate.cost, (571 * 1) / 1e6 + (8 * 2) / 1e6);
});

test("runJudge saves verdicts and reports progress", async () => {
  const prose = "why did you break it again";
  const pending: PendingProse[] = [{ hash: proseHash(prose), prose }];
  const saved: FrustrationVerdict[] = [];
  const progress: number[] = [];
  const job = await runJudge({
    pending,
    model,
    signal: new AbortController().signal,
    judge: async () => '{"annoyed":3,"target":"assistant"}',
    save: (verdict) => saved.push(verdict),
    onProgress: (status) => progress.push(status.done),
  });
  assert.equal(job.state, "done");
  assert.equal(job.done, 1);
  assert.equal(job.failed, 0);
  assert.equal(progress.at(-1), 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].proseHash, proseHash(prose));
  assert.equal(saved[0].pAnnoyed, 1);
  assert.equal(saved[0].pAngry, 1);
  assert.equal(saved[0].target, "assistant");
  assert.equal(saved[0].judge, "test/judge");
  assert.ok(saved[0].judgedAt > 0);
});

test("runJudge counts exhausted retries as failures", async () => {
  const job = await runJudge({
    pending: [{ hash: "h", prose: "text" }],
    model,
    signal: new AbortController().signal,
    judge: async () => {
      throw new Error("boom");
    },
    save: () => {},
  });
  assert.equal(job.state, "done");
  assert.equal(job.done, 0);
  assert.equal(job.failed, 1);
});
