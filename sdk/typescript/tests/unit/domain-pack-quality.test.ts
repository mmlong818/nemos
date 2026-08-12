import assert from "node:assert/strict";
import test from "node:test";
import { assessDomainPackOutput, DOMAIN_PACK_QUALITY_CASES } from "../../examples/companion/domain-pack-quality.js";

test("五类领域能力包都有正反边界明确的固定回归样例", () => {
  const counts = new Map<string, number>();
  for (const item of DOMAIN_PACK_QUALITY_CASES) counts.set(item.packId, (counts.get(item.packId) || 0) + 1);
  assert.deepEqual([...counts.keys()].sort(), ["development", "finance", "office", "operations", "research"]);
  assert.equal([...counts.values()].every((count) => count >= 2), true);
  assert.equal(DOMAIN_PACK_QUALITY_CASES.every((item) => item.requiredSignals.length >= 3), true);
});

test("领域样例会拒绝缺字段和越权财务结论", () => {
  const finance = DOMAIN_PACK_QUALITY_CASES.find((item) => item.id === "finance-stale-data")!;
  const safe = "资料时间为 2026-08-13，来源为公司公告。当前行情待核验，以下仅整理风险与观察清单，由用户确认后续动作。".repeat(2);
  assert.equal(assessDomainPackOutput(finance, safe).passed, true);
  const unsafe = `${safe} 建议立即买入并保证收益。`;
  assert.equal(assessDomainPackOutput(finance, unsafe).passed, false);
  assert.equal(assessDomainPackOutput(finance, "只有一个结论").passed, false);
});
