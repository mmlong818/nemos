// storyline.test.ts — v0.8 故事线线索化
//
// 验证：线内记忆按线归集且默认不外泄、续期拿得到「上次做到哪」、
//       活跃排序只被实质进展影响，以及线本身能跨重启存活。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Nemos } from "../../src/index.js";
import { makeMockLLMConfig } from "../helpers.js";

function createNemos(storagePath?: string): Nemos {
  return new Nemos({
    storage: storagePath ? { type: "sqlite", path: storagePath } : { type: "memory" },
    llm: makeMockLLMConfig(),
    features: { autoLinking: false },
    worker: { manualWorker: true },
  });
}

/** 让下一次 nowIso() 落在不同毫秒上。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

const note = (content: string) => ({
  layer: "episodic" as const,
  content,
  source: { authoritative: false, origin: "test", chain_depth: 1 },
});

test("起线后写入的记忆归属这条线，其它角色默认看不到", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const story = await user.startStoryline({ title: "小丑鱼上线准备", participants: ["研究员"] });

  const memory = await user.writeToStoryline(story.id, note("发布检查清单已过一轮"));
  assert.deepEqual(memory.visibility?.owner, { kind: "storyline", id: story.id });

  // 不带 storylineId 的读取方拿不到这条线的记忆。
  const outsider = await user.recall("发布检查清单", {
    viewer: { userId: "alice", agentId: "写作者" },
  });
  assert.equal(
    outsider.items.some((item) => item.memory.content.includes("发布检查清单")),
    false,
    JSON.stringify(outsider.items.map((i) => i.memory.content)),
  );

  // 带上这条线的读取方能拿到。
  const insider = await user.recall("发布检查清单", {
    viewer: { userId: "alice", storylineId: story.id },
  });
  assert.ok(insider.items.some((item) => item.memory.content.includes("发布检查清单")));

  await nemos.close();
});

test("续期先给摘要和悬空项，再给线内记忆", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const story = await user.startStoryline({ title: "港股简报改版" });
  await user.writeToStoryline(story.id, note("已确认数据源口径"));
  await user.updateStoryline(story.id, {
    digest: "数据源口径已定，待接盘前简报模板",
    open_threads: ["盘前模板还没定稿"],
  });

  const resumed = await user.resumeStoryline(story.id);
  assert.ok(resumed);
  assert.equal(resumed.storyline.digest, "数据源口径已定，待接盘前简报模板");
  assert.deepEqual(resumed.storyline.open_threads, ["盘前模板还没定稿"]);
  assert.deepEqual(resumed.recent.map((m) => m.content), ["已确认数据源口径"]);

  assert.equal(await user.resumeStoryline("story_不存在"), null);
  await nemos.close();
});

test("续期只返回本线记忆，不把用户私有记忆混进来", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const story = await user.startStoryline({ title: "边界验证" });
  await user.writeToStoryline(story.id, note("线内的结论"));
  // 用户私有记忆：viewer 同时持有 user 身份，若不按归属过滤就会被带出来。
  await user.write(note("与这条线无关的私人事实"));

  const resumed = await user.resumeStoryline(story.id);
  assert.deepEqual(resumed?.recent.map((m) => m.content), ["线内的结论"]);
  await nemos.close();
});

test("只有实质进展会刷新活跃时间，改标题不会把线顶到最前", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const first = await user.startStoryline({ title: "先起的线" });
  // 时间戳是毫秒精度：不等一下两条线会落在同一毫秒，排序就只剩 tiebreak 决定。
  await tick();
  const second = await user.startStoryline({ title: "后起的线" });

  // 改标题不 touch：排序应当不变。
  const renamed = await user.updateStoryline(first.id, { title: "改了名的线" });
  assert.equal(renamed?.title, "改了名的线");
  assert.equal(renamed?.last_event_at, first.last_event_at);
  assert.deepEqual(
    (await user.listStorylines()).map((s) => s.id),
    [second.id, first.id],
  );

  // touch 之后才顶到最前。
  await tick();
  await user.updateStoryline(first.id, { touch: true });
  assert.deepEqual(
    (await user.listStorylines()).map((s) => s.id),
    [first.id, second.id],
  );
  await nemos.close();
});

test("按状态和参与角色筛线", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  const open = await user.startStoryline({ title: "进行中", participants: ["研究员"] });
  const done = await user.startStoryline({ title: "已收口", participants: ["写作者"] });
  await user.updateStoryline(done.id, { status: "done" });

  assert.deepEqual(
    (await user.listStorylines({ status: ["open"] })).map((s) => s.id),
    [open.id],
  );
  assert.deepEqual(
    (await user.listStorylines({ participantId: "写作者" })).map((s) => s.id),
    [done.id],
  );

  // 追加参与角色不重复。
  const joined = await user.updateStoryline(open.id, {
    add_participants: ["写作者", "研究员"],
  });
  assert.deepEqual(joined?.participant_ids, ["研究员", "写作者"]);
  await nemos.close();
});

test("故事线跨重启存活，续期仍能接上", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-storyline-"));
  const dbPath = join(dir, "m.db");
  try {
    const first = createNemos(dbPath);
    const story = await first
      .forUser("alice")
      .startStoryline({ title: "跨重启的线", scope: "project:小丑鱼" });
    await first.forUser("alice").writeToStoryline(story.id, note("重启前写下的进展"));
    await first.forUser("alice").updateStoryline(story.id, { digest: "重启前的摘要" });
    await first.close();

    const second = createNemos(dbPath);
    const resumed = await second.forUser("alice").resumeStoryline(story.id);
    assert.equal(resumed?.storyline.title, "跨重启的线");
    assert.equal(resumed?.storyline.scope, "project:小丑鱼");
    assert.equal(resumed?.storyline.digest, "重启前的摘要");
    assert.deepEqual(resumed?.recent.map((m) => m.content), ["重启前写下的进展"]);
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("往不存在的线写入直接报错，而不是静默丢掉归属", async () => {
  const nemos = createNemos();
  const user = nemos.forUser("alice");
  await assert.rejects(
    () => user.writeToStoryline("story_不存在", note("孤儿记忆")),
    /故事线不存在/,
  );
  await nemos.close();
});
