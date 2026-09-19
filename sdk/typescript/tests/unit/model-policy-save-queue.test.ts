import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { createLatestPolicyQueue } = require(join(__dirname, "..", "..", "examples", "companion", "web", "assets", "model-policy-save-queue.js"));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test("模型连续三次修改只落首个和最后一个，最后选择胜出", async () => {
  const first = deferred<string>();
  const calls: string[] = [];
  const committed: string[] = [];
  let outcomes: Map<string, { ok: boolean; operation: { value: string } }> | undefined;
  const queue = createLatestPolicyQueue({
    execute: async (operation: { value: string }) => {
      calls.push(operation.value);
      if (operation.value === "terra") return first.promise;
      return operation.value;
    },
    onCommitted: (value: string) => committed.push(value),
    onSettled: (value: typeof outcomes) => { outcomes = value; },
  });
  queue.enqueue({ key: "routing:scene:assistant:chat", value: "terra" });
  queue.enqueue({ key: "routing:scene:assistant:chat", value: "astra" });
  queue.enqueue({ key: "routing:scene:assistant:chat", value: "luna" });
  first.resolve("terra");
  await queue.waitForIdle();
  assert.deepEqual(calls, ["terra", "luna"]);
  assert.deepEqual(committed, ["terra", "luna"]);
  assert.equal(outcomes?.get("routing:scene:assistant:chat")?.operation.value, "luna");
});

test("思考强度连续修改遵循最后选择，最终失败回到最近确认状态", async () => {
  const first = deferred<string>();
  const committed: string[] = [];
  let finalOutcome: { ok: boolean; operation: { value: string }; error?: Error } | undefined;
  const queue = createLatestPolicyQueue({
    execute: async (operation: { value: string }) => {
      if (operation.value === "low") return first.promise;
      throw new Error("latest failed");
    },
    onCommitted: (value: string) => committed.push(value),
    onSettled: (outcomes: Map<string, typeof finalOutcome>) => { finalOutcome = outcomes.get("reasoning:scene:assistant"); },
  });
  queue.enqueue({ key: "reasoning:scene:assistant", value: "low" });
  queue.enqueue({ key: "reasoning:scene:assistant", value: "high" });
  queue.enqueue({ key: "reasoning:scene:assistant", value: "max" });
  first.resolve("low");
  await queue.waitForIdle();
  assert.deepEqual(committed, ["low"]);
  assert.equal(finalOutcome?.ok, false);
  assert.equal(finalOutcome?.operation.value, "max");
  assert.match(finalOutcome?.error?.message || "", /latest failed/);
});
