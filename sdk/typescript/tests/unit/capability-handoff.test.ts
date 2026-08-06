import assert from "node:assert/strict";
import test from "node:test";

import {
  createCapabilityHandoffEnvelope,
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
