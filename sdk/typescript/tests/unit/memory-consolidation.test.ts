import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_MEMORY_SCOPE, MEMORY_ANCHOR_CAP } from "../../examples/companion/memory-config.js";
import { failureShapeByName, listFailureShapes } from "../../examples/companion/failure-registry.js";
// 折算函数导出出来直接测：它的每个分支都对应一种用户可见的不同后果。
import { normalizeConsolidation } from "../../examples/companion/engine.js";

// 整合状态按 (tenant, user, space) 存。makeMem() 当前两项都不传，所以这里必须是
// SDK 的默认值；跟丢了会让状态读取命中不存在的行，返回空状态、永远报「没有失败」。
test("整合状态的行键与 makeMem 传给内核的一致", async () => {
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(COMPANION_MEMORY_SCOPE, { tenantId: "default", spaceId: "global" });
  const server = readFileSync("examples/companion/server.ts", "utf8");
  const makeMem = server.slice(server.indexOf("function makeMem("), server.indexOf("function makeEngine("));
  for (const key of ["tenantId", "defaultScope"]) {
    assert.equal(makeMem.includes(key), false,
      `makeMem() 开始传 ${key} 了，COMPANION_MEMORY_SCOPE 必须跟着改，否则整合状态读的是另一行`);
  }
});

test("记忆域只登记应用侧真能区分的落点，且都指向 engine.ts", () => {
  const memory = listFailureShapes().filter((shape) => shape.domain === "memory");
  const consolidation = memory.filter((shape) => shape.name.startsWith("memory"));
  assert.deepEqual(consolidation.map((shape) => shape.name), [
    "memoryConsolidationFailed",
    "memoryConsolidationLeaseHeld",
    "memoryConsolidationNoOutput",
    "memoryEvidenceCapped",
  ]);
  for (const shape of consolidation) assert.match(shape.seededFrom, /engine\.ts/);
  // 「租约被占」和「抛错未完成」都值得重试；「没有产出」和「依据被裁剪」重试同一批输入结果一样。
  assert.deepEqual(consolidation.map((shape) => shape.retryable), [true, true, false, false]);
});

test("锚点上限是正整数，且被失败说明引用", () => {
  assert.ok(Number.isInteger(MEMORY_ANCHOR_CAP) && MEMORY_ANCHOR_CAP > 0);
  assert.match(failureShapeByName("memoryEvidenceCapped")!.summary, /上限/);
});

test("四种整合结果互斥，且各自带上对应的失败编号", () => {
  const normalize = normalizeConsolidation;

  const skipped = normalize({ episodicConsumed: 0, anchorCount: 3, derived: [], skippedReason: "lease-held" });
  assert.equal(skipped.outcome, "skipped");
  assert.deepEqual(skipped.notes.map((n: any) => n.name), ["memoryConsolidationLeaseHeld"]);

  const noInput = normalize({ episodicConsumed: 0, anchorCount: 3, derived: [] });
  assert.equal(noInput.outcome, "no-input");
  assert.deepEqual(noInput.notes, [], "没有输入不是失败");

  const noOutput = normalize({ episodicConsumed: 5, anchorCount: 3, derived: [] });
  assert.equal(noOutput.outcome, "no-output");
  assert.equal(noOutput.consumed, 5);
  assert.deepEqual(noOutput.notes.map((n: any) => n.name), ["memoryConsolidationNoOutput"]);
  assert.equal(noOutput.notes[0].retryable, false, "同一批输入重试通常得到同一结果");

  const done = normalize({ episodicConsumed: 5, anchorCount: 3, derived: [{}, {}], invalidated: 1 });
  assert.equal(done.outcome, "consolidated");
  assert.equal(done.derived, 2);
  assert.equal(done.invalidated, 1);
  assert.deepEqual(done.notes, []);
});

// 依据被裁剪不影响结论是否写入，但必须让调用方知道结论只依据了子集。
test("锚点超上限时附带裁剪提示，且不改变结果分类", () => {
  const normalize = normalizeConsolidation;
  const capped = normalize({ episodicConsumed: 5, anchorCount: MEMORY_ANCHOR_CAP + 1, derived: [{}] });
  assert.equal(capped.outcome, "consolidated");
  assert.deepEqual(capped.notes.map((n: any) => n.name), ["memoryEvidenceCapped"]);
  assert.equal(capped.notes[0].payload.anchorCount, String(MEMORY_ANCHOR_CAP + 1));

  const atCap = normalize({ episodicConsumed: 5, anchorCount: MEMORY_ANCHOR_CAP, derived: [{}] });
  assert.deepEqual(atCap.notes, [], "恰好等于上限没有被裁剪");

  // 跳过时也要保留裁剪提示，否则一次租约冲突会把它吞掉。
  const cappedSkip = normalize({ episodicConsumed: 0, anchorCount: MEMORY_ANCHOR_CAP + 1, derived: [], skippedReason: "lease-held" });
  assert.deepEqual(cappedSkip.notes.map((n: any) => n.name), ["memoryEvidenceCapped", "memoryConsolidationLeaseHeld"]);
});
