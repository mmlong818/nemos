import assert from "node:assert/strict";
import test from "node:test";
import { Nemos } from "../../src/index.js";
import { COMPANION_MEMORY_SCOPE } from "../../examples/companion/memory-config.js";
import { listMemoryRecords, readMemoryRecord } from "../../examples/companion/memory-record-view.js";
import { makeMockLLMConfig } from "../helpers.js";

function fixture() {
  const memory = new Nemos({
    storage: { type: "sqlite", path: ":memory:" },
    llm: makeMockLLMConfig(),
    worker: { manualWorker: true },
  });
  const view = { memory, owner: "me", speaker: "我", learnings: [] };
  return { memory, view, store: memory.forUser(view.owner) };
}

test("旧记录和可见来源可以按 ID 打开，不依赖最近 500 条列表", async (t) => {
  const { memory, store, view } = fixture();
  t.after(() => memory.close());
  const source = await store.ingest("这段来源仅来自该用户的原始消息", {
    scope: "conv:me:clownfish", skipAnalysis: true,
    identity: { speakerId: "user:me", subjectId: "user:me", sourceMessageId: "message-original", conversationId: "conversation-original" },
  });
  const early = await store.write({
    layer: "personal_semantic", content: "用户偏好表格", scope: "conv:me:clownfish",
    source: { origin: "clownfish-memory-ui", authoritative: false }, archival_ref: source.archival.id,
  });
  const storage = memory.raw().storage;
  for (let index = 0; index < 501; index++) {
    storage.insert(COMPANION_MEMORY_SCOPE.tenantId, "me", {
      ...early, id: `memory-later-${index}`, archival_ref: undefined, claim_key: undefined,
      content: `更近期的记录 ${index}`, created_at: new Date(Date.now() + 60_000 + index).toISOString(),
      promotion_state: "promoted",
    });
  }
  assert.equal((await listMemoryRecords(view)).some((entry) => entry.id === early.id), false);
  const result = readMemoryRecord(view, early.id);
  assert.equal(result.status, "active");
  if (result.status !== "active") assert.fail("cannot read active record");
  assert.equal(result.fact.content, "偏好表格");
  assert.equal(result.fact.source.sourceMessageId, "message-original");
  assert.equal(result.fact.source.excerpt, "这段来源仅来自该用户的原始消息");
});

test("用户、可见性和有效性共同约束详情与列表", async (t) => {
  const { memory, store, view } = fixture();
  t.after(() => memory.close());
  const write = { layer: "procedural", scope: "global", source: { origin: "clownfish-memory-ui", authoritative: false } } as const;
  const other = await memory.forUser("another").write({ ...write, content: "另一个用户的正文" });
  const wrongScope = await store.write({ ...write, content: "其他人员可见的正文", visibility: { owner: { kind: "agent", id: "another" } } });
  const restrictedArchive = await store.write({
    layer: "archival", content: "其他人员可见的来源正文", scope: "global", source: { origin: "test", authoritative: true },
    visibility: { owner: { kind: "agent", id: "another" } },
  });
  const inactive = await store.write({ ...write, content: "用户偏好已失效的格式" });
  const invalidation = await store.invalidate(inactive.id, "已更换");
  const active = await store.write({
    ...write, content: "用户偏好简短的格式", archival_ref: restrictedArchive.id,
    visibility: { owner: { kind: "agent", id: "shared" }, sharedWith: [{ kind: "user", id: "me" }] },
  });
  assert.deepEqual(readMemoryRecord(view, inactive.id), { status: "inactive" });
  for (const id of [other.id, wrongScope.id, restrictedArchive.id, "does-not-exist"]) {
    assert.deepEqual(readMemoryRecord(view, id), { status: "unavailable" });
  }
  const activeDetail = readMemoryRecord(view, active.id);
  if (activeDetail.status !== "active") assert.fail("cannot read shared active record");
  assert.equal(activeDetail.fact.source.excerpt, undefined);
  assert.equal(activeDetail.fact.source.archivalId, undefined);
  const listed = await listMemoryRecords(view);
  assert.deepEqual(new Set(listed.map((entry) => entry.id)), new Set([active.id, invalidation.source_event_id]));
  assert.doesNotMatch(JSON.stringify(listed), /已失效的格式|其他人员可见|另一个用户的正文/);
});
