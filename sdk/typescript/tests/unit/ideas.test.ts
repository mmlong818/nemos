import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { IDEA_LIMITS, IdeaStore, ideaPrompt, parseIdeas } from "../../examples/companion/ideas.js";

const page = require("../../examples/companion/web/assets/ideas.js");

function tempFile(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "ideas-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return join(dir, "ideas.json");
}
const good = { title: "我可以做一个冰岛行李清单", summary: "按衣物、证件分组，能勾选", rationale: "你在准备冰岛自驾", deliverable: "widget", startPrompt: "帮我做一个能勾选的冰岛行李清单" };

test("点子校验：交付类型要在清单里；做不到的（邮件、日历、下单）不收；和最近重复的不收；最多五个；两周后过期", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const raw = JSON.stringify({ ideas: [
    good,
    { ...good, title: "我可以整理你的收件箱", startPrompt: "帮我整理邮件" },
    { ...good, title: "我可以帮你订酒店", deliverable: "report", summary: "比较后帮你订酒店" },
    { ...good, title: "类型不对的", deliverable: "email" },
    { ...good, title: "缺开场白", startPrompt: "" },
    { ...good, title: "我可以做一个冰岛行李清单！" },
    { ...good, title: "上次提过的" },
  ] });
  const ideas = parseIdeas(raw, ["上次提过的"], now);
  assert.deepEqual(ideas.map((i) => i.title), ["我可以做一个冰岛行李清单"]);
  assert.equal(ideas[0].state, "available");
  assert.equal(Date.parse(ideas[0].expiresAt) - now.getTime(), IDEA_LIMITS.ttlDays * 86400_000);
  const many = JSON.stringify({ ideas: Array.from({ length: 9 }, (_, i) => ({ ...good, title: `我可以做第 ${i} 件事` })) });
  assert.equal(parseIdeas(many, []).length, IDEA_LIMITS.perBatch);
  assert.deepEqual(parseIdeas("{\"ideas\": []}", []), []);
});

test("反馈：更多类似留着；不感兴趣要理由并下架；开始过的标出来；过期的不显示；口味进下一次提示", (t) => {
  const file = tempFile(t);
  const store = new IdeaStore(file);
  const now = new Date();
  const [a, b, c] = parseIdeas(JSON.stringify({ ideas: [good, { ...good, title: "我可以帮你拆读书目标" }, { ...good, title: "我可以每周给你一份复盘" }] }), [], now);
  const expired = { ...c, id: "old", title: "过期的", expiresAt: new Date(now.getTime() - 1000).toISOString() };
  store.add([a, b, c, expired]);
  store.feedback(a.id, "more", undefined, "多来点旅行的");
  assert.throws(() => store.feedback(b.id, "less", "随便", ""), /请选一个理由/);
  store.feedback(b.id, "less", "太具体", "");
  store.started(c.id);
  const visible = new IdeaStore(file).visible().map((i) => i.title);
  assert.deepEqual(visible, [a.title, c.title], "不感兴趣的和过期的不显示");
  const taste = store.taste();
  assert.deepEqual(taste.more, [a.title]);
  assert.deepEqual(taste.less, [`${b.title}（太具体）`]);
  assert.deepEqual(taste.started, [c.title]);
  const { system, user } = ideaPrompt({ today: "今天", goals: ["读完 4 本书"], matters: [], preferences: [], feedTopic: "冰岛", taste });
  assert.match(system, /你还不能读邮件、看日历、下单付款/);
  assert.match(system, /没有真正有用的就返回 \{"ideas": \[\]\}/);
  assert.match(user, /"不想要":\["我可以帮你拆读书目标（太具体）"\]/);
  writeFileSync(file, "{broken");
  assert.deepEqual(new IdeaStore(file).visible(), []);
});

test("页面：卡片写明交付什么和为什么想到你；马上开始带编号进聊天；不感兴趣展开理由", () => {
  const [idea] = parseIdeas(JSON.stringify({ ideas: [good] }), []);
  const container = { innerHTML: "" };
  page.render(container, { ideas: [idea], modelReady: true }, { lessOpen: idea.id });
  assert.match(container.innerHTML, /小工具/);
  assert.match(container.innerHTML, /为什么想到你：你在准备冰岛自驾/);
  assert.match(container.innerHTML, new RegExp(`href="/\\?idea=${idea.id}"`));
  assert.match(container.innerHTML, /data-reason="太具体"/);
  assert.equal(page.daysLeft(idea), IDEA_LIMITS.ttlDays);
});
