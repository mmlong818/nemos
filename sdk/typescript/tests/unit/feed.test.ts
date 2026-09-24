import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { DEFAULT_FEED_PROMPT, FEED_LIMITS, FeedStore, feedWritePrompt, parseFeedPlan, parseFeedPosts, parseJsonObject } from "../../examples/companion/feed.js";

const page = require("../../examples/companion/web/assets/feed.js");

function tempFile(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "feed-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return join(dir, "feed.json");
}
const sources = [
  { title: "冰岛气象局发布大风预警", url: "https://en.vedur.is/weather/warnings/", content: "南部阵风 25 m/s" },
  { title: "没有链接的条目", url: "javascript:alert(1)", content: "x" },
];

test("模型输出里取 JSON：前后有说明文字、代码块也能取到；取不到返回 null", () => {
  assert.deepEqual(parseJsonObject("好的：\n```json\n{\"queries\": [\"a\"]}\n```"), { queries: ["a"] });
  assert.equal(parseJsonObject("没有 JSON"), null);
  assert.deepEqual(parseFeedPlan("{\"queries\": [\"冰岛 自驾 天气\", \"冰岛 自驾 天气\", \"x\", \"读书习惯\", \"第四个\"]}"), ["冰岛 自驾 天气", "读书习惯", "第四个"]);
});

test("帖子校验：新闻必须引用真实来源编号，否则丢掉；非 http 链接不收；和最近重复的不收；最多五条", () => {
  const raw = JSON.stringify({ posts: [
    { kind: "news", title: "南部大风预警", body: "周四南部阵风可达 25 m/s。", sources: [1] },
    { kind: "news", title: "编的新闻", body: "没有来源", sources: [] },
    { kind: "news", title: "坏链接新闻", body: "只引用了坏链接", sources: [2] },
    { kind: "news", title: "越界编号", body: "编号不存在", sources: [9] },
    { kind: "goal", title: "读书目标：这周该读第二本了", body: "按计划每晚 20 分钟。", sources: [] },
    { kind: "tip", title: "上次发过的", body: "重复", sources: [] },
    { kind: "tip", title: "", body: "没标题" },
  ] });
  const posts = parseFeedPosts(raw, sources, ["上次发过的"], "b1", "2026-09-25T01:00:00.000Z");
  assert.deepEqual(posts.map((p) => [p.kind, p.title]), [["news", "南部大风预警"], ["goal", "读书目标：这周该读第二本了"]]);
  assert.deepEqual(posts[0].sources, [{ title: "冰岛气象局发布大风预警", url: "https://en.vedur.is/weather/warnings/" }]);
  const many = JSON.stringify({ posts: Array.from({ length: 9 }, (_, i) => ({ kind: "tip", title: `建议 ${i}`, body: "有用" })) });
  assert.equal(parseFeedPosts(many, [], [], "b2").length, FEED_LIMITS.perBatch);
  assert.deepEqual(parseFeedPosts("{\"posts\": []}", sources, [], "b3"), []);
});

test("写作提示写明如实规则：新闻只写来源里的事实、没有就返回空、目标不编进展", () => {
  const { system, user } = feedWritePrompt({ prompt: DEFAULT_FEED_PROMPT, goals: ["读完 4 本书"], matters: [], preferences: [], recentTitles: [], today: "2026年9月25日" }, sources, "联网搜了 1 个词");
  assert.match(system, /只写下面"来源"里真的有的事实/);
  assert.match(system, /没有值得写的就返回 \{"posts": \[\]\}/);
  assert.match(system, /不编造进展/);
  assert.match(user, /"编号":1/);
});

test("存储：话题可改、批次和帖子跨重启保留、点喜欢、超过上限丢最旧的批次和它的帖子", (t) => {
  const file = tempFile(t);
  const store = new FeedStore(file);
  assert.equal(store.snapshot().prompt, DEFAULT_FEED_PROMPT);
  assert.throws(() => store.setPrompt("  "), /不能是空的/);
  store.setPrompt("冰岛自驾和读书");
  const post = { id: "p1", batchId: "b1", createdAt: "2026-09-25T01:00:00Z", kind: "tip" as const, title: "t", body: "b", sources: [] };
  store.addBatch({ id: "b1", at: "2026-09-25T01:00:00Z", status: "posted", note: "", queries: [] }, [post]);
  store.like("p1", true);
  const reopened = new FeedStore(file).snapshot();
  assert.equal(reopened.prompt, "冰岛自驾和读书");
  assert.equal(reopened.posts[0].liked, true);
  for (let i = 0; i < FEED_LIMITS.batches; i++) store.addBatch({ id: `x${i}`, at: "2026-09-25T02:00:00Z", status: "empty", note: "空", queries: [] }, []);
  assert.equal(store.snapshot().batches.length, FEED_LIMITS.batches);
  assert.equal(store.snapshot().posts.length, 0, "最旧的批次被挤掉后，它的帖子一起删");
  writeFileSync(file, "{broken");
  assert.equal(new FeedStore(file).snapshot().prompt, DEFAULT_FEED_PROMPT);
});

test("页面：批次标题按今天/昨天/日期；只渲染 http(s) 来源链接；讨论链接带帖子编号", () => {
  const now = new Date(2026, 8, 25, 10, 0);
  assert.equal(page.batchLabel(new Date(2026, 8, 25, 9, 5).toISOString(), now), "今天 09:05");
  assert.equal(page.batchLabel(new Date(2026, 8, 24, 21, 40).toISOString(), now), "昨天 21:40");
  assert.equal(page.batchLabel(new Date(2026, 8, 20, 8, 0).toISOString(), now), "9月20日 08:00");
  assert.equal(page.safeUrl("javascript:alert(1)"), "");
  assert.equal(page.safeUrl("https://a.b/c"), "https://a.b/c");
  assert.equal(page.discussHref({ id: "p 1" }), "/?discuss=p%201");
});
