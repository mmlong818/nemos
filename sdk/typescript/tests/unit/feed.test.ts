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

// 真实使用里一篇 2022 年的吉他谱被标成了"新消息"：来源都看得出日期、又都是一个月以前的，只能算建议。
test("新消息的来源都是一个月以前的就改记为建议；有来源看不出日期时照原样；日期交给写作提示", () => {
  const dated = [
    { title: "成都吉他谱（发布时间：2022-05-18 17:30:00）", url: "https://a.example/254.html", content: "C 调初级版" },
    { title: "赵雷《成都》吉他谱", url: "https://b.example/5018.html", content: "简单版", publishedAt: "2020-07-19" },
    { title: "巡演官宣", url: "https://c.example/tour", content: "成都站 11 月开票", publishedAt: "2026-09-20 10:00:00" },
    { title: "没写日期的页面", url: "https://d.example/x", content: "内容" },
  ];
  const raw = JSON.stringify({ posts: [
    { kind: "news", title: "有初级版弹唱谱", body: "和弦简化过。", sources: [1, 2] },
    { kind: "news", title: "成都站开票", body: "11 月开票。", sources: [3] },
    { kind: "news", title: "旧的加没日期的", body: "看不出新旧。", sources: [1, 4] },
  ] });
  const posts = parseFeedPosts(raw, dated, [], "b1", "2026-09-26T01:00:00.000Z");
  assert.deepEqual(posts.map((p) => [p.title, p.kind]), [["有初级版弹唱谱", "tip"], ["成都站开票", "news"], ["旧的加没日期的", "news"]]);
  assert.equal(posts[0].sources.length, 2, "改成建议后来源照样保留");
  const prompt = JSON.parse(feedWritePrompt({ today: "2026-09-26", prompt: "吉他", goals: [], matters: [], preferences: [], recentTitles: [] }, dated, "").user);
  assert.deepEqual(prompt.来源.map((s: { 日期?: string }) => s.日期 ?? null), ["2022-05-18", "2020-07-19", "2026-09-20", null]);
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

test("口味：只认喜欢、讨论、不感兴趣；不感兴趣要选理由且和喜欢互斥；可撤销、可删除；写作提示带上口味和'为什么给你看'", (t) => {
  const store = new FeedStore(tempFile(t));
  const mk = (id: string, title: string) => ({ id, batchId: "b1", createdAt: "2026-09-25T01:00:00Z", kind: "tip" as const, title, body: "b", sources: [] });
  store.addBatch({ id: "b1", at: "2026-09-25T01:00:00Z", status: "posted", note: "", queries: [] }, [mk("a", "冰岛自驾路况"), mk("b", "加密货币行情"), mk("c", "读书方法"), mk("d", "只是看过")]);
  store.like("a", true);
  assert.throws(() => store.dislike("b", "随便", ""), /请选一个理由/);
  store.dislike("b", "不相关", "我不炒币");
  store.markDiscussed("c");
  assert.deepEqual(store.taste(), { liked: ["冰岛自驾路况", "读书方法"], disliked: ["加密货币行情（不相关：我不炒币）"] });
  store.like("b", true);
  assert.equal(store.snapshot().posts.find((p) => p.id === "b")!.disliked, undefined, "喜欢会清掉不感兴趣");
  store.dislike("a", "太重复", "");
  assert.equal(store.snapshot().posts.find((p) => p.id === "a")!.liked, false);
  store.dislike("a", null, "");
  assert.equal(store.snapshot().posts.find((p) => p.id === "a")!.disliked, undefined, "撤销");
  store.remove("d");
  assert.equal(store.snapshot().posts.some((p) => p.id === "d"), false);
  assert.throws(() => store.remove("d"), /不存在/);

  const { system, user } = feedWritePrompt({ prompt: "x", goals: [], matters: [], preferences: [], recentTitles: [], today: "今天", taste: { liked: ["冰岛自驾路况"], disliked: ["加密货币行情（不相关）"] } }, [], "没联网");
  assert.match(system, /每条都带 why：用"你"来写/);
  assert.match(system, /不许说读过对方没给的数据/);
  assert.match(user, /"喜欢过":\["冰岛自驾路况"\]/);
  assert.match(user, /"不想看":\["加密货币行情（不相关）"\]/);
  const posts = parseFeedPosts(JSON.stringify({ posts: [{ kind: "tip", title: "t", body: "b", why: "你在准备冰岛自驾" }] }), [], [], "b9");
  assert.equal(posts[0].why, "你在准备冰岛自驾");

  const container = { innerHTML: "" };
  page.render(container, { prompt: "p", modelReady: true, searchAvailable: true, batches: [{ id: "b1", at: "2026-09-25T01:00:00Z", status: "posted", note: "" }], posts: [{ ...mk("x", "被嫌弃的"), disliked: { reason: "太具体", at: "" } }, { ...mk("y", "正常的"), why: "按你的话题" }] }, { dislikeOpen: "y" });
  assert.match(container.innerHTML, /已标记不感兴趣（太具体）：被嫌弃的/);
  assert.match(container.innerHTML, /为什么给你看：按你的话题/);
  assert.match(container.innerHTML, /data-reason="太重复"/);
});

test("想听、别提进写作和搜索词提示；点子提示也带上", async () => {
  const ctx = { prompt: "x", goals: [], matters: [], preferences: [], recentTitles: [], today: "今天", topics: { tellMe: "读书方法", neverMention: "加密货币" } };
  const write = feedWritePrompt(ctx, [], "没联网");
  assert.match(write.system, /"别提"里写的话题一律不写，也不要换个说法绕回来/);
  assert.match(write.user, /"想听":"读书方法","别提":"加密货币"/);
  const { feedPlanPrompt } = await import("../../examples/companion/feed.js");
  const plan = feedPlanPrompt(ctx);
  assert.match(plan.system, /"别提"里的话题不要搜/);
  assert.match(plan.user, /"别提":"加密货币"/);
  const { ideaPrompt } = await import("../../examples/companion/ideas.js");
  const idea = ideaPrompt({ today: "今天", goals: [], matters: [], preferences: [], feedTopic: "", topics: ctx.topics, taste: { more: [], less: [], started: [], recent: [] } });
  assert.match(idea.system, /"别提"里写的话题不要碰/);
  assert.match(idea.user, /"别提":"加密货币"/);
});
