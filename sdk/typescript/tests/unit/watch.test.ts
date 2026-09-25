import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { WATCH_LIMITS, WatchStore, parseWatchCheck, watchCheckPrompt } from "../../examples/companion/watch.js";

function tempFile(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "watch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return join(dir, "watch.json");
}
const at = (h: number, m = 0, d = 25) => new Date(2026, 8, d, h, m);
const sources = [{ title: "冰岛道路管理局：1 号公路东段临时封闭", url: "https://umferdin.is/en", content: "因大风封闭" }];

test("清单：每行一件、去重、最多五件、每件不超长；改清单时保留原来那件事的上次结论；间隔 1–24 小时", (t) => {
  const store = new WatchStore(tempFile(t));
  store.update({ items: "冰岛 1 号公路有没有封路\n\n冰岛 1 号公路有没有封路\n《被讨厌的勇气》出没出新版" });
  assert.deepEqual(store.snapshot().items.map((i) => i.text), ["冰岛 1 号公路有没有封路", "《被讨厌的勇气》出没出新版"]);
  const first = store.snapshot().items[0];
  store.record(first.id, { status: "quiet", summary: "目前全线通行" });
  store.update({ items: ["冰岛 1 号公路有没有封路", "新的一件"] });
  assert.equal(store.snapshot().items[0].lastSummary, "目前全线通行");
  assert.throws(() => store.update({ items: Array.from({ length: 6 }, (_, i) => `事 ${i}`) }), /最多盯 5 件事/);
  assert.throws(() => store.update({ items: ["x".repeat(WATCH_LIMITS.text + 1)] }), /不超过/);
  assert.throws(() => store.update({ intervalMinutes: 30 }), /1 到 24 小时/);
});

test("排期：关着、清单空都不跑；满间隔才跑；每天最多 48 次，额度不够就少看几件，第二天重置", (t) => {
  const store = new WatchStore(tempFile(t));
  store.update({ items: ["a", "b", "c"], intervalMinutes: 60 });
  assert.equal(store.due(at(9)), false, "默认关着");
  store.update({ enabled: true });
  assert.equal(store.due(at(9)), true);
  assert.equal(store.beginRun(at(9)).length, 3);
  assert.equal(store.due(at(9, 59)), false);
  assert.equal(store.due(at(10)), true);
  for (let h = 10; h < 25 && store.remainingChecks(at(Math.min(h, 23))) > 0; h++) store.beginRun(at(Math.min(h, 23), h >= 23 ? h - 22 : 0));
  assert.equal(store.remainingChecks(at(23, 30)), 0);
  assert.equal(store.due(at(23, 59)), false, "今天额度用完");
  assert.equal(store.remainingChecks(at(8, 0, 26)), WATCH_LIMITS.dailyChecks, "第二天重置");
});

test("判断：要提醒必须有真实来源和一句话；和上次一样就不提醒；提醒进待取列表，回执后不再给聊天页", (t) => {
  assert.equal(parseWatchCheck(JSON.stringify({ notify: true, summary: "东段封闭", message: "1 号公路东段因大风临时封闭。", sources: [1] }), sources).notify, true);
  assert.equal(parseWatchCheck(JSON.stringify({ notify: true, summary: "东段封闭", message: "封了", sources: [] }), sources).notify, false, "没来源不提醒");
  assert.equal(parseWatchCheck(JSON.stringify({ notify: true, summary: "x", message: "", sources: [1] }), sources).notify, false);
  assert.equal(parseWatchCheck("乱码", sources).summary, "没查到相关的新消息");
  const { system, user } = watchCheckPrompt({ id: "i", text: "冰岛 1 号公路有没有封路", createdAt: "", lastSummary: "目前全线通行" }, sources, "今天");
  assert.match(system, /和"上次看到"的情况一样、或者只是换了说法，notify=false/);
  assert.match(system, /不用自己的记忆补/);
  assert.match(system, /来源没写日期、或看不出是最近的，就不要说"现在"/);
  assert.match(user, /"上次看到":"目前全线通行"/);

  const store = new WatchStore(tempFile(t));
  store.update({ items: ["冰岛 1 号公路有没有封路"], enabled: true });
  const item = store.snapshot().items[0];
  const alert = store.record(item.id, { status: "alerted", summary: "东段封闭", alert: { message: "东段封闭了", sources: [{ title: "t", url: "https://umferdin.is/en" }] } })!;
  assert.deepEqual(store.pendingAlerts().map((a) => a.id), [alert.id]);
  store.acknowledge(alert.id);
  assert.deepEqual(store.pendingAlerts(), []);
  assert.equal(store.recentAlerts().length, 1, "托盘去重仍能看到最近的");
});
