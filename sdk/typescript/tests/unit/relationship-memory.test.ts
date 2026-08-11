// relationship-memory.test.ts — v0.8 关系记忆
//
// 验证：同一请求对不同对象给出不同口径、硬边界不会被观察挤掉、
//       没有档案时不编造，以及档案跨重启存活。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RelationshipMemory } from "../../examples/companion/relationship-memory.js";

function store(): { memory: RelationshipMemory; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-relationship-"));
  return {
    memory: new RelationshipMemory(dir),
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("不同对象给出不同口径", () => {
  const { memory, cleanup } = store();
  try {
    memory.upsert("li-zong", {
      displayName: "李总",
      relation: "client",
      tone: "正式、先给结论、不展开技术细节",
      boundaries: ["不能提我们内部的成本结构"],
    });
    memory.upsert("axiang", {
      displayName: "阿翔",
      relation: "teammate",
      tone: "直接、可以展开技术细节",
    });

    const client = memory.buildPromptBlock("li-zong");
    const teammate = memory.buildPromptBlock("axiang");
    assert.match(client, /关系：客户/);
    assert.match(client, /不展开技术细节/);
    assert.match(client, /不能提我们内部的成本结构/);
    assert.match(teammate, /关系：同事/);
    assert.match(teammate, /可以展开技术细节/);
    // 客户的边界不能泄漏到同事的口径里。
    assert.ok(!teammate.includes("成本结构"));
  } finally {
    cleanup();
  }
});

test("没有档案时返回空串，不编造对方偏好", () => {
  const { memory, cleanup } = store();
  try {
    assert.equal(memory.buildPromptBlock("素未谋面"), "");
    assert.equal(memory.get("素未谋面"), undefined);
  } finally {
    cleanup();
  }
});

test("用户说过的和自己总结的分开标注", () => {
  const { memory, cleanup } = store();
  try {
    memory.upsert("li-zong", {
      displayName: "李总",
      addNotes: [
        { text: "只在上午看邮件", source: "user" },
        { text: "似乎更关心交付时间而不是价格", source: "observed" },
      ],
    });
    const block = memory.buildPromptBlock("li-zong");
    assert.match(block, /### 用户明确说过[\s\S]*只在上午看邮件/);
    assert.match(block, /### 从过往互动总结（未经用户确认）[\s\S]*更关心交付时间/);
  } finally {
    cleanup();
  }
});

test("观察积累到上限时截断观察，硬边界一条都不能少", () => {
  const { memory, cleanup } = store();
  try {
    memory.upsert("li-zong", { boundaries: ["不能提成本", "不能承诺排期"] });
    for (let i = 0; i < 80; i += 1) {
      memory.upsert("li-zong", { addNotes: [{ text: `观察 ${i}`, source: "observed" }] });
    }
    const profile = memory.get("li-zong");
    assert.ok(profile);
    assert.equal(profile.notes.length, 50, "观察应当被截断");
    // 边界被挤掉等于悄悄放开限制，这是这条测试真正要守的东西。
    assert.deepEqual(profile.boundaries, ["不能提成本", "不能承诺排期"]);
    assert.match(memory.buildPromptBlock("li-zong"), /不能承诺排期/);
  } finally {
    cleanup();
  }
});

test("边界写明高于风格偏好，冲突时要先说明而不是自行突破", () => {
  const { memory, cleanup } = store();
  try {
    memory.upsert("li-zong", { boundaries: ["不能提成本"] });
    assert.match(memory.buildPromptBlock("li-zong"), /硬边界（不得违反）/);
    assert.match(memory.buildPromptBlock("li-zong"), /先说明冲突，不要自行突破/);
  } finally {
    cleanup();
  }
});

test("互动计数与首末次时间随记录推进", () => {
  const { memory, cleanup } = store();
  try {
    const first = memory.upsert("li-zong", { recordInteraction: true });
    assert.equal(first.interactionCount, 1);
    assert.ok(first.firstInteractionAt);
    const second = memory.upsert("li-zong", { recordInteraction: true });
    assert.equal(second.interactionCount, 2);
    assert.equal(second.firstInteractionAt, first.firstInteractionAt, "首次互动时间不该被后来的互动改写");
    // 不带 recordInteraction 的更新不计数。
    assert.equal(memory.upsert("li-zong", { tone: "更简短" }).interactionCount, 2);
  } finally {
    cleanup();
  }
});

test("未知关系类型落到 other，不接受任意字符串", () => {
  const { memory, cleanup } = store();
  try {
    const profile = memory.upsert("x", { relation: "老板的朋友" as never });
    assert.equal(profile.relation, "other");
  } finally {
    cleanup();
  }
});

test("档案跨重启存活", () => {
  const { memory, dir, cleanup } = store();
  try {
    memory.upsert("li-zong", {
      displayName: "李总",
      relation: "client",
      boundaries: ["不能提成本"],
      recordInteraction: true,
    });
    const reopened = new RelationshipMemory(dir);
    const profile = reopened.get("li-zong");
    assert.equal(profile?.displayName, "李总");
    assert.equal(profile?.relation, "client");
    assert.deepEqual(profile?.boundaries, ["不能提成本"]);
    assert.equal(profile?.interactionCount, 1);
    assert.equal(reopened.remove("li-zong"), true);
    assert.equal(new RelationshipMemory(dir).get("li-zong"), undefined);
  } finally {
    cleanup();
  }
});

test("关系档案确实进入下发给模型的提示，而不是只躺在存储里", async () => {
  const { CapabilityRuntime } = await import("../../examples/companion/capabilities.js");
  const { memory, cleanup } = store();
  const dataDir = mkdtempSync(join(tmpdir(), "clownfish-relationship-runtime-"));
  try {
    memory.upsert("li-zong", {
      displayName: "李总",
      relation: "client",
      tone: "正式、先给结论",
      boundaries: ["不能提我们内部的成本结构"],
    });

    const prompts: string[] = [];
    const runtime = new CapabilityRuntime({
      dataDir,
      personas: () => [{ id: "clownfish", name: "小丑鱼", tag: "", expert: false }],
      // notify 收到的就是组装完的提示，直接在这里截下来。
      notify: async (_personaId, text) => {
        prompts.push(text);
        // 必须带完成标记，否则运行时会判定截断并发起续写，
        // prompts 里就混进了续写提示，断言会落到错误的那一条上。
        return { reply: "本周进展说明。\n交付完成。", facts: [] };
      },
      counterpartContext: (counterpartId) => memory.buildPromptBlock(counterpartId),
    });

    // 用自建能力而不是原生能力：原生能力要求模型返回结构化 JSON，
    // 这里要验的是提示组装，不该被交付格式校验绊住。
    const ability = runtime.createGeneratedAbility({
      personaId: "clownfish",
      name: "对外进展说明",
      goal: "说明本周进展",
      defaultFormat: "md",
    });
    const withCounterpart = runtime.createTask({
      title: "给李总的进展说明",
      personaId: "clownfish",
      capabilityId: ability.id,
      instruction: "说明本周进展",
      format: "md",
      counterpartId: "li-zong",
    });
    assert.equal(withCounterpart.counterpartId, "li-zong");
    await runtime.runTask(withCounterpart.id, "test");
    const targeted = prompts.at(0) ?? "";
    assert.match(targeted, /沟通对象：李总/);
    assert.match(targeted, /不能提我们内部的成本结构/);

    // 没指定对象的任务里不该出现任何一份关系档案。
    const plain = runtime.createTask({
      title: "普通任务",
      personaId: "clownfish",
      capabilityId: ability.id,
      instruction: "随便写点",
      format: "md",
    });
    const before = prompts.length;
    await runtime.runTask(plain.id, "test");
    const untargeted = prompts.slice(before).join("\n");
    assert.ok(!untargeted.includes("沟通对象"), untargeted.slice(0, 400));
  } finally {
    cleanup();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
