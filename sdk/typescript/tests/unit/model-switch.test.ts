import assert from "node:assert/strict";
import test from "node:test";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

import {
  ModelSwitchBusyError,
  ModelSwitchCoordinator,
  ModelSwitchJobsActiveError,
} from "../../examples/companion/model-switch.js";

function harness(options: { jobs?: boolean[] } = {}) {
  const queue = [...(options.jobs ?? [false])];
  let clock = 1_700_000_000_000;
  const log: string[] = [];
  let held = 0;
  const coordinator = new ModelSwitchCoordinator({
    hasActiveJobs: () => (queue.length > 1 ? Boolean(queue.shift()) : Boolean(queue[0])),
    holdJobIntake: () => {
      held += 1;
      log.push("hold");
      return () => { held -= 1; log.push("release"); };
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  return { coordinator, log, held: () => held, clock: () => clock };
}

test("成功切换：经过 validating→activating→committed，闸门开合成对", async () => {
  const h = harness();
  const phases: string[] = [];
  const value = await h.coordinator.run({ target: "zhipu/glm-4" }, async () => {
    phases.push(h.coordinator.state().phase);
    return "done";
  });
  assert.equal(value, "done");
  assert.deepEqual(phases, ["activating"], "activate 执行时必须已在 activating 阶段");
  assert.deepEqual(h.log, ["hold", "release"], "任务领取闸门必须开合成对");
  assert.equal(h.held(), 0);
  const state = h.coordinator.state();
  assert.equal(state.phase, "idle");
  assert.equal(state.attempt, null);
  assert.equal(state.recent[0]?.phase, "committed");
  assert.equal(state.recent[0]?.target, "zhipu/glm-4");
  assert.equal(state.recent[0]?.drainedMs, 0);
});

test("activate 失败记为 rolled_back，错误原样抛出，闸门仍然释放", async () => {
  const h = harness();
  await assert.rejects(
    h.coordinator.run({ target: "openai/gpt" }, async () => { throw new Error("boot 失败"); }),
    /boot 失败/,
  );
  assert.deepEqual(h.log, ["hold", "release"]);
  const state = h.coordinator.state();
  assert.equal(state.phase, "idle", "失败后必须回到 idle，否则后续切换会被永久挡住");
  assert.equal(state.recent[0]?.phase, "rolled_back");
  assert.match(String(state.recent[0]?.error), /boot 失败/);
});

test("有任务在跑且没给排空预算：拒绝，且什么都不做", async () => {
  const h = harness({ jobs: [true] });
  let activated = false;
  await assert.rejects(
    h.coordinator.run({ target: "zhipu/glm-4" }, async () => { activated = true; }),
    (error: unknown) => error instanceof ModelSwitchJobsActiveError && error.code === "model_jobs_active",
  );
  assert.equal(activated, false, "前置检查没过就不该碰运行时");
  assert.deepEqual(h.log, [], "被拒绝的切换不该 stop/start worker——那会扰动在跑任务的领取时序");
  const state = h.coordinator.state();
  assert.equal(state.recent[0]?.phase, "refused", "没进 activating 就不能谎报成已回滚");
  assert.equal(state.phase, "idle");
});

test("给了预算就排空等待：任务结束后继续切换，并记下等了多久", async () => {
  // hasActiveJobs 依次返回：true（前置检查）、true（第一次轮询）、false（第二次轮询）
  const h = harness({ jobs: [true, true, false, false] });
  let activated = false;
  await h.coordinator.run({ target: "zhipu/glm-4", drainMs: 5_000 }, async () => { activated = true; });
  assert.equal(activated, true);
  const state = h.coordinator.state();
  assert.equal(state.recent[0]?.phase, "committed");
  assert.ok((state.recent[0]?.drainedMs ?? 0) > 0, "排空耗时要记下来");
});

test("排空超预算：按 model_jobs_active 拒绝，不切换", async () => {
  const h = harness({ jobs: [true] });
  let activated = false;
  await assert.rejects(
    h.coordinator.run({ target: "zhipu/glm-4", drainMs: 1_000 }, async () => { activated = true; }),
    (error: unknown) => error instanceof ModelSwitchJobsActiveError,
  );
  assert.equal(activated, false);
  assert.equal(h.coordinator.state().recent[0]?.phase, "refused");
});

test("同一时刻只允许一次切换：第二次以 model_update_busy 拒绝", async () => {
  const h = harness();
  let releaseActivate: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { releaseActivate = resolve; });
  const first = h.coordinator.run({ target: "a/b" }, async () => { await blocked; });
  await assert.rejects(
    h.coordinator.run({ target: "c/d" }, async () => {}),
    (error: unknown) => error instanceof ModelSwitchBusyError && error.code === "model_update_busy",
  );
  releaseActivate?.();
  await first;
  assert.equal(h.coordinator.state().phase, "idle");
  // 并发被拒不留记录：那次请求连前置检查都没跑到，记下来只会让双击变成噪音，
  // 也会去动另一次切换正在持有的 attempt。留记录的是真正评估过的尝试。
  assert.equal(h.coordinator.state().recent.length, 1);
  assert.equal(h.coordinator.state().recent[0]?.target, "a/b");
});

test("尝试记录有上限，新的在前", async () => {
  const h = harness();
  for (const target of ["a", "b", "c"]) {
    await h.coordinator.run({ target }, async () => {});
  }
  const recent = h.coordinator.state().recent;
  assert.deepEqual(recent.map((item) => item.target), ["c", "b", "a"]);
});

test("tryLock 与切换共用同一把互斥锁：检查和目录读取不会插进切换中途", async () => {
  const h = harness();
  let releaseActivate: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { releaseActivate = resolve; });
  const switching = h.coordinator.run({ target: "a/b" }, async () => { await blocked; });
  assert.equal(h.coordinator.tryLock(), null, "切换进行中拿不到锁");
  releaseActivate?.();
  await switching;

  const unlock = h.coordinator.tryLock();
  assert.ok(unlock, "切换结束后能拿到锁");
  assert.equal(h.coordinator.tryLock(), null, "锁是互斥的");
  // 纯互斥不该被当成切换：phase 保持 idle，也不留尝试记录。
  assert.equal(h.coordinator.state().phase, "idle");
  const before = h.coordinator.state().recent.length;
  unlock();
  unlock();
  assert.equal(h.coordinator.state().recent.length, before, "上锁不产生尝试记录");
  assert.ok(h.coordinator.tryLock(), "重复释放不该把锁弄坏");
});

test("持锁期间发起切换：以 model_update_busy 拒绝", async () => {
  const h = harness();
  const unlock = h.coordinator.tryLock();
  assert.ok(unlock);
  await assert.rejects(
    h.coordinator.run({ target: "a/b" }, async () => {}),
    (error: unknown) => error instanceof ModelSwitchBusyError,
  );
  unlock();
  await h.coordinator.run({ target: "a/b" }, async () => {});
  assert.equal(h.coordinator.state().recent[0]?.phase, "committed");
});

// —— 接线守卫 ——
// 协调器的价值全在"每个改连接的入口都走它"。漏掉一个就等于那条路径没有闸门，
// 所以这里钉住接线本身，而不只是协调器的内部行为。

test("四个模型设置入口都经过协调器，且旧的布尔量已彻底移除", () => {
  const server = readServerRouteSurface();
  // 改连接的两个入口走完整切换（含排空与任务领取闸门）。
  const config = server.slice(server.indexOf('url === "/api/llm-config"'), server.indexOf('url === "/api/llm-key"'));
  assert.match(config, /modelSwitch\.run\(/);
  assert.match(config, /waitForJobsMs/, "要允许调用方给排空预算");
  const key = server.slice(server.indexOf('url === "/api/llm-key"'), server.indexOf('url === "/api/llm-key"') + 2_000);
  assert.match(key, /modelSwitch\.run\(/);
  // 不改连接但必须与切换互斥的两个入口只上锁。
  assert.equal((server.match(/modelSwitch\.tryLock\(\)/g) || []).length, 2, "显式检查与目录读取各上一次锁");
  // 原来那个进程内布尔量不能再存在，否则会出现两套互斥机制。
  assert.doesNotMatch(server, /modelConnectionUpdating/);
  // 切换进展要能被界面读到。
  assert.match(server, /switchState: modelSwitch\.state\(\)/);
});

test("切换期间用 worker 的 stop/start 挡住新任务领取", () => {
  const server = readServerRouteSurface();
  const wiring = server.slice(server.indexOf("const modelSwitch = new ModelSwitchCoordinator("), server.indexOf("const modelSwitch = new ModelSwitchCoordinator(") + 600);
  assert.match(wiring, /holdJobIntake:[\s\S]*agentJobWorker\.stop\(\)/);
  assert.match(wiring, /return \(\) => agentJobWorker\.start\(\)/);
  assert.match(wiring, /hasActiveJobs: \(\) => hasActiveModelJobs\(\)/);
});

test("停掉领取之后任务才溜进来：仍然拒绝，且闸门已归位", async () => {
  // hasActiveJobs 依次：false（排空前）、true（停掉闸门后的二次确认）
  const h = harness({ jobs: [false, true, false] });
  let activated = false;
  await assert.rejects(
    h.coordinator.run({ target: "a/b" }, async () => { activated = true; }),
    (error: unknown) => error instanceof ModelSwitchJobsActiveError,
  );
  assert.equal(activated, false);
  assert.deepEqual(h.log, ["hold", "release"], "闸门开了就必须关回去");
  assert.equal(h.coordinator.state().phase, "idle");
  assert.equal(h.coordinator.state().recent[0]?.phase, "refused");
});
