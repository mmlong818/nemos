/**
 * 定时任务的如实告知。
 *
 * 创建定时任务那一刻，模型最容易许下"每天 8 点准时发你""一有变化就告诉你"这种承诺。
 * 小丑鱼是本机应用，真实的运行条件是（见 capabilities.ts 的 isDue 与
 * background-scheduler.ts 的启动补跑）：
 *   - 每日任务只在应用运行时触发，调度每 15 秒检查一次；
 *   - 到点时应用没开，当天晚些时候打开会补跑一次；整天没开就跳过，不会追补；
 *   - 按轮次的任务按对话轮数触发，与时间无关；手动任务不会自己运行。
 * 这段文字随任务创建结果交给模型，由模型原样转告用户，而不是让它自己发挥措辞。
 */
import type { CapabilitySchedule } from "./capabilities.js";

const WEEKDAY = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

function when(schedule: CapabilitySchedule): string {
  const time = schedule.time || "09:00";
  const zone = schedule.timezone ? `（${schedule.timezone}）` : "";
  const days = [...new Set(schedule.days?.length ? schedule.days : EVERY_DAY)].filter((d) => d >= 1 && d <= 7).sort();
  if (days.length === 7) return `每天 ${time}${zone}`;
  return `每${days.map((d) => WEEKDAY[d]).join("、")} ${time}${zone}`;
}

export function scheduleNotice(schedule: CapabilitySchedule): string {
  if (schedule.mode === "daily") {
    return [
      `这个任务会在${when(schedule)}左右运行，只在小丑鱼在这台电脑上运行时触发。`,
      "到点时应用没开，当天晚些时候打开会补跑一次；整天没打开就跳过，不会追补。",
      "它是按时间定期运行，不是实时盯着，两次运行之间发生的变化要到下一次才会知道。",
      "转告用户时照这个说，不要承诺准点送达。",
    ].join("");
  }
  if (schedule.mode === "turns") {
    const every = Math.max(1, schedule.everyTurns ?? 5);
    return `这个任务每和小丑鱼对话 ${every} 轮运行一次，和时间无关；不聊天就不会运行。转告用户时照这个说，不要说成按时间定时运行。`;
  }
  return "这个任务不会自己运行，需要用户手动运行。转告用户时照这个说，不要暗示它会自动执行。";
}
