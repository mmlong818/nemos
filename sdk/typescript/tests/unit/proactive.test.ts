import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { DEFAULT_PROACTIVE, ProactiveStore, feedDue, inQuietHours } from "../../examples/companion/proactive.js";

function store(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "proactive-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return join(dir, "proactive.json");
}
const at = (h: number, m = 0, d = 25) => new Date(2026, 8, d, h, m);

test("免打扰：默认关闭；跨午夜的时段两头都算；开始等于结束视为全天", () => {
  assert.equal(inQuietHours(DEFAULT_PROACTIVE, at(23)), false);
  const night = { ...DEFAULT_PROACTIVE, quietHours: { enabled: true, start: "22:00", end: "08:00" } };
  assert.equal(inQuietHours(night, at(23, 30)), true);
  assert.equal(inQuietHours(night, at(7, 59)), true);
  assert.equal(inQuietHours(night, at(8, 0)), false);
  assert.equal(inQuietHours(night, at(21, 59)), false);
  const lunch = { ...DEFAULT_PROACTIVE, quietHours: { enabled: true, start: "12:00", end: "13:30" } };
  assert.equal(inQuietHours(lunch, at(12, 45)), true);
  assert.equal(inQuietHours(lunch, at(13, 30)), false);
  assert.equal(inQuietHours({ ...DEFAULT_PROACTIVE, quietHours: { enabled: true, start: "09:00", end: "09:00" } }, at(15)), true);
});

test("动态定时：到点且今天没跑过才跑；错过当天补一次，不补昨天；打开时点已过从明天开始", (t) => {
  const file = store(t);
  const s = new ProactiveStore(file);
  assert.equal(feedDue(s.get(), at(9)), false, "默认关闭");
  // 早上 7 点打开 8 点的自动生成：今天 8 点会跑。
  s.update({ feedSchedule: { enabled: true, time: "08:00" } }, at(7));
  assert.equal(feedDue(s.get(), at(7, 59)), false);
  assert.equal(feedDue(s.get(), at(10)), true, "8 点没开应用，10 点打开时补一次");
  s.markFeedRun(at(10));
  assert.equal(feedDue(s.get(), at(11)), false, "同一天只跑一次");
  assert.equal(feedDue(s.get(), at(8, 1, 26)), true, "第二天到点再跑");
  // 晚上 9 点把时间改成 8 点：今天的点已过，不立刻补跑。
  s.update({ feedSchedule: { time: "08:30" } }, at(21, 0, 26));
  assert.equal(feedDue(s.get(), at(21, 5, 26)), false);
  assert.equal(new ProactiveStore(file).get().feedSchedule.time, "08:30", "跨重启保留");
  assert.throws(() => s.update({ quietHours: { start: "25:00" } }), /HH:MM/);
  s.update({ feedSchedule: { lastRunDate: "2000-01-01" } }, at(9, 0, 27));
  assert.notEqual(s.get().feedSchedule.lastRunDate, "2000-01-01", "页面不能改调度记录");
});

test("想听、别提：随手写的一段话，跨重启保留，超长拒绝，只改其中一栏不动另一栏", (t) => {
  const file = store(t);
  const s = new ProactiveStore(file);
  assert.deepEqual(s.get().topics, { tellMe: "", neverMention: "" });
  s.update({ topics: { tellMe: "冰岛自驾、读书方法", neverMention: "加密货币" } });
  s.update({ topics: { neverMention: "加密货币、娱乐八卦" } });
  assert.deepEqual(new ProactiveStore(file).get().topics, { tellMe: "冰岛自驾、读书方法", neverMention: "加密货币、娱乐八卦" });
  assert.throws(() => s.update({ topics: { tellMe: "x".repeat(501) } }), /不能超过 500 个字/);
});
