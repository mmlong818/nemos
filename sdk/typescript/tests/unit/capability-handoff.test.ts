import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapabilityHandoffEnvelope,
  failCapabilityHandoff,
  isCapabilityHandoffDelivered,
  receiveCapabilityHandoff,
  renderCapabilityHandoffContext,
  returnCapabilityHandoff,
} from "../../examples/companion/capability-handoff.js";

test("交接包同时保存原文、提要、人物身份、材料指纹和版本", () => {
  const envelope = createCapabilityHandoffEnvelope({
    source: "chat",
    sourceConversationKey: "persona:feifei",
    goal: "继续完成方案",
    summary: "用户已经确认先做本地版本。",
    conversation: [
      { sourceMessageId: "m1", role: "user", speakerId: "user:cat", subjectId: "user:cat", speaker: "猫叔", text: "我还在加班，先做本地版本。" },
      { sourceMessageId: "m2", role: "assistant", speakerId: "agent:feifei", subjectId: "agent:feifei", speaker: "菲菲", text: "我记住了。" },
    ],
    materials: [{ name: "方案.md", text: "第一版方案" }],
    constraints: ["不要联网"],
    unresolved: ["验证导出格式"],
  }, "document-draft", new Date("2026-08-06T10:00:00.000Z"));

  assert.ok(envelope);
  assert.equal(envelope.conversation.length, 2);
  assert.equal(envelope.conversation[0]?.speakerId, "user:cat");
  assert.equal(envelope.conversation[1]?.subjectId, "agent:feifei");
  assert.equal(envelope.materials[0]?.byteLength, Buffer.byteLength("第一版方案"));
  assert.match(envelope.materials[0]?.contentHash || "", /^[a-f0-9]{64}$/);
  assert.match(envelope.baseRevision, /^[a-f0-9]{64}$/);
  assert.match(envelope.contentHash, /^[a-f0-9]{64}$/);
  const context = renderCapabilityHandoffContext(envelope);
  assert.match(context, /完整原文/);
  assert.match(context, /猫叔：我还在加班/);
  assert.match(context, /约束/);
});

test("交接包去掉重复原文和重复材料，并允许执行入口避免重复提要", () => {
  const envelope = createCapabilityHandoffEnvelope({
    goal: "整理材料",
    summary: "只保留一份提要",
    conversation: [
      { sourceMessageId: "m1", role: "user", text: "原文" },
      { sourceMessageId: "m1", role: "user", text: "原文" },
    ],
    materials: [
      { name: "材料.md", text: "同一份内容" },
      { name: "材料副本.md", text: "同一份内容" },
    ],
  }, "document-draft")!;
  assert.equal(envelope.conversation.length, 1);
  assert.equal(envelope.materials.length, 1);
  const context = renderCapabilityHandoffContext(envelope, { includeSummary: false });
  assert.doesNotMatch(context, /只保留一份提要/);
  assert.match(context, /原文/);
  assert.match(context, /同一份内容/);
});

test("交接回执保留同一个内容指纹并绑定返回产物", () => {
  const envelope = createCapabilityHandoffEnvelope({ goal: "继续整理" }, "research-brief")!;
  const received = receiveCapabilityHandoff(envelope, new Date("2026-08-06T10:01:00.000Z"));
  const returned = returnCapabilityHandoff(received, "artifact-1", new Date("2026-08-06T10:02:00.000Z"));

  assert.equal(received.status, "received");
  assert.equal(returned.status, "returned");
  assert.equal(returned.contentHash, envelope.contentHash);
  assert.equal(returned.resultArtifactId, "artifact-1");
});

test("空交接不会制造持久任务上下文", () => {
  assert.equal(createCapabilityHandoffEnvelope({}, "document-draft"), undefined);
});

test("交接失败有自己的落点，不会显示为已完成", () => {
  const envelope = createCapabilityHandoffEnvelope(
    { goal: "整理这份材料", summary: "提要" },
    "research-brief",
  );
  assert.ok(envelope);
  const received = receiveCapabilityHandoff(envelope);
  assert.equal(received.status, "received");
  assert.equal(isCapabilityHandoffDelivered(received), false, "刚接手不算交付");

  const failed = failCapabilityHandoff(received, { kind: "execution", error: "工具返回空结果" });
  assert.equal(failed.status, "failed");
  assert.ok(failed.failedAt);
  assert.equal(failed.error, "工具返回空结果");
  assert.equal(failed.retryable, true);
  // 关键：失败回执不得携带任何交付痕迹。
  assert.equal(failed.returnedAt, undefined);
  assert.equal(failed.resultArtifactId, undefined);
  assert.equal(isCapabilityHandoffDelivered(failed), false);
});

test("失败类型决定可重试性，不靠猜错误文本", () => {
  const envelope = createCapabilityHandoffEnvelope({ goal: "目标" }, "research-brief");
  assert.ok(envelope);
  const received = receiveCapabilityHandoff(envelope);
  const kinds = [
    ["execution", true],
    ["timeout", true],
    ["missing-capability", false],
    ["rejected", false],
  ] as const;
  for (const [kind, retryable] of kinds) {
    const failed = failCapabilityHandoff(received, { kind });
    assert.equal(failed.retryable, retryable, `${kind} 的可重试性`);
    assert.ok(failed.error, `${kind} 应当有默认失败说明`);
  }
  // 超时要提示先对账，避免重复副作用。
  assert.match(failCapabilityHandoff(received, { kind: "timeout" }).error!, /对账/);
});

test("returned 但没有产物按失败处理，不算交付", () => {
  const envelope = createCapabilityHandoffEnvelope({ goal: "目标" }, "research-brief");
  assert.ok(envelope);
  const received = receiveCapabilityHandoff(envelope);
  const empty = returnCapabilityHandoff(received, "   ");
  assert.equal(empty.status, "failed", "空手而归不能显示成完成");
  assert.equal(isCapabilityHandoffDelivered(empty), false);

  const delivered = returnCapabilityHandoff(received, "artifact-1");
  assert.equal(delivered.status, "returned");
  assert.equal(isCapabilityHandoffDelivered(delivered), true);
});

test("失败后重试成功会清掉失败痕迹，不会同时显示交付和失败", () => {
  const envelope = createCapabilityHandoffEnvelope({ goal: "目标" }, "research-brief");
  assert.ok(envelope);
  const failed = failCapabilityHandoff(receiveCapabilityHandoff(envelope), { kind: "timeout" });
  const retried = returnCapabilityHandoff(failed, "artifact-2");
  assert.equal(retried.status, "returned");
  assert.equal(retried.failedAt, undefined);
  assert.equal(retried.failureKind, undefined);
  assert.equal(retried.retryable, undefined);
  assert.equal(retried.error, undefined);
  assert.equal(isCapabilityHandoffDelivered(retried), true);
});
