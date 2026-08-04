import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateCompanionCosts,
  estimateCompanionModelCost,
} from "../../examples/companion/model-pricing.js";

test("estimates BigModel China token cost from actual Agent usage", () => {
  const cost = estimateCompanionModelCost("glm-5.2", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    totalTokens: 2_000_000,
    modelCalls: 2,
  });

  assert.deepEqual(cost?.breakdowns, [{
    currency: "CNY",
    inputAmount: 8,
    outputAmount: 28,
    totalAmount: 36,
  }]);
  assert.equal(cost?.pricedRuns, 1);
  assert.equal(cost?.unpricedRuns, 0);
});

test("aggregates priced runs and reports models missing from the price table", () => {
  const first = estimateCompanionModelCost("glm-5.2", {
    inputTokens: 100_000,
    outputTokens: 10_000,
    totalTokens: 110_000,
    modelCalls: 1,
  });
  assert.ok(first);
  assert.equal(estimateCompanionModelCost("custom-model", {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    modelCalls: 1,
  }), null);

  const total = aggregateCompanionCosts([first], 1);
  assert.equal(total.pricedRuns, 1);
  assert.equal(total.unpricedRuns, 1);
  assert.equal(total.breakdowns[0]?.totalAmount, 1.08);
});