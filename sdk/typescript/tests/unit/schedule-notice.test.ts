import assert from "node:assert/strict";
import test from "node:test";

import { scheduleNotice } from "../../examples/companion/schedule-notice.js";

// 创建定时任务那一刻，模型最容易许下"每天 8 点准时发你""一有变化就告诉你"这种承诺。
// 本机应用的真实运行条件和云端服务不同，这段说明要把条件原样交给模型转告用户。
test("每日任务：写出实际生效的时间，说明应用关着时的补跑规则，且不是实时监控", () => {
  const notice = scheduleNotice({ mode: "daily", time: "08:00", timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] });
  assert.match(notice, /每天 08:00（Asia\/Shanghai）/);
  assert.match(notice, /小丑鱼在这台电脑上运行时/);
  assert.match(notice, /当天晚些时候打开会补跑一次/);
  assert.match(notice, /整天没打开就跳过/);
  assert.match(notice, /不是实时盯着/);
  assert.match(notice, /不要承诺准点送达/);
});

test("每日任务只在部分日子运行时，写出是哪几天", () => {
  assert.match(scheduleNotice({ mode: "daily", time: "09:30", days: [1, 2, 3, 4, 5] }), /每周一、周二、周三、周四、周五 09:30/);
  assert.match(scheduleNotice({ mode: "daily", time: "09:30", days: [6, 7] }), /每周六、周日 09:30/);
});

test("按轮次的任务与时间无关；手动任务不会自己运行", () => {
  const turns = scheduleNotice({ mode: "turns", everyTurns: 20 });
  assert.match(turns, /每和小丑鱼对话 20 轮运行一次/);
  assert.match(turns, /和时间无关/);
  assert.doesNotMatch(turns, /每天/);
  const manual = scheduleNotice({ mode: "manual" });
  assert.match(manual, /不会自己运行/);
  assert.match(manual, /需要用户手动运行/);
});
