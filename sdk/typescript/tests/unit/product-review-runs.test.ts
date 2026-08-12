import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProductReviewRunStore } from "../../examples/companion/product-review-runs.js";

test("真实检查记录可持久保存并汇总未修问题", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-product-review-"));
  try {
    const store = new ProductReviewRunStore(dir);
    store.append({
      round: 1,
      persona: "第一次使用办公 AI 的白领",
      scenario: "上传 Word 后完成编辑并另存",
      route: "/office",
      status: "issues",
      observations: ["能够找到上传入口", "另存入口不够醒目"],
      issues: [{ severity: "medium", title: "另存入口弱", detail: "用户完成编辑后需要寻找保存动作。" }],
      evidence: ["/office#file-1"],
    });
    const reopened = new ProductReviewRunStore(dir);
    assert.equal(reopened.list().length, 1);
    assert.deepEqual(reopened.summary(), {
      total: 1,
      passed: 0,
      blocked: 0,
      openIssues: 1,
      highIssues: 0,
      latestAt: reopened.list()[0].createdAt,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("真实检查拒绝没有实际观察的空记录", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-product-review-empty-"));
  try {
    const store = new ProductReviewRunStore(dir);
    assert.throws(() => store.append({ round: 2, persona: "程序员", scenario: "开发项目", route: "/capabilities", status: "passed", observations: [], issues: [], evidence: [] }), /至少需要一条实际观察/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
