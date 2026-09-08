import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssistantBotStore } from "../../examples/companion/assistant-team.js";
import { listBotMarket } from "../../examples/companion/bot-market.js";
import {
  isEmptyRecipe,
  normalizeBotRecipe,
  recipeConsentToken,
} from "../../examples/companion/bot-recipe.js";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

function runtimeAt(dir: string) {
  return new CapabilityRuntime({
    dataDir: dir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    notify: async () => ({ reply: "结果", facts: [] }),
  });
}

function hostOf(runtime: CapabilityRuntime) {
  return {
    capabilityIds: () => runtime.listAbilities().map((item) => item.id),
    installSkill: (input: Parameters<CapabilityRuntime["installSkill"]>[0]) => runtime.installSkill(input),
    createTask: (input: Parameters<CapabilityRuntime["createTask"]>[0]) => runtime.createTask(input),
  };
}

/** 目录里唯一带配方的模板；如果以后有第二个，这里应当跟着覆盖。 */
function templateWithRecipe() {
  const template = listBotMarket().find((item) => !isEmptyRecipe(item.recipe));
  assert.ok(template, "市场目录里应当至少有一个带配方的模板");
  return template;
}

test("市场目录里的配方本身通过校验，且指向真实存在的能力", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-catalog-"));
  try {
    const abilityIds = runtimeAt(dir).listAbilities().map((item) => item.id);
    for (const template of listBotMarket()) {
      const recipe = normalizeBotRecipe(template.recipe, abilityIds);
      // 带了配方也不改变这条声明：模板不能带来一个会自己跑起来的任务。
      assert.equal(template.permissions.automaticRoutines, false);
      for (const skill of recipe.skills) {
        assert.ok(skill.description.length > 5, `${template.id} 的技能缺少何时使用的说明`);
        assert.ok(skill.content.includes("#"), `${template.id} 的技能正文不像 Markdown 流程`);
      }
      for (const routine of recipe.routines) {
        assert.ok(abilityIds.includes(routine.capabilityId));
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("普通添加不带同意信息：Bot 照样建立，配方一项都不落地", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-plain-"));
  const store = new AssistantBotStore(":memory:");
  try {
    const runtime = runtimeAt(dir);
    const template = templateWithRecipe();
    const skillsBefore = runtime.listAbilities().length;
    const tasksBefore = runtime.snapshot().tasks.length;

    const bot = store.importTemplate("me", { id: template.id, version: template.version }, hostOf(runtime));
    assert.equal(bot.template?.id, template.id);
    assert.equal(bot.recipeReceipt, undefined, "没同意就不该有落地收据");
    assert.equal(runtime.listAbilities().length, skillsBefore);
    assert.equal(runtime.snapshot().tasks.length, tasksBefore);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("带令牌勾选后落地：技能进技能库、定时任务建成暂停、收据留在 Bot 上", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-apply-"));
  const store = new AssistantBotStore(":memory:");
  try {
    const runtime = runtimeAt(dir);
    const template = templateWithRecipe();
    const recipe = normalizeBotRecipe(template.recipe, runtime.listAbilities().map((item) => item.id));
    const token = recipeConsentToken({ templateId: template.id, templateVersion: template.version, recipe });

    const bot = store.importTemplate("me", {
      id: template.id,
      version: template.version,
      consent: { token, skills: recipe.skills.map((item) => item.key), routines: recipe.routines.map((item) => item.key) },
    }, hostOf(runtime));

    const receipt = bot.recipeReceipt;
    assert.ok(receipt);
    assert.equal(receipt.trust, "untrusted");
    assert.equal(receipt.templateId, template.id);
    assert.equal(receipt.items.length, recipe.skills.length + recipe.routines.length);
    assert.deepEqual(receipt.items.filter((item) => item.error), [], "目录里的配方应当全部装得上");

    for (const item of receipt.items.filter((entry) => entry.kind === "skill")) {
      assert.ok(runtime.listAbilities().some((ability) => ability.id === item.localId));
    }
    for (const item of receipt.items.filter((entry) => entry.kind === "routine")) {
      const task = runtime.snapshot().tasks.find((entry) => entry.id === item.localId);
      assert.ok(task);
      assert.equal(task.enabled, false, "配方带来的定时任务必须先是暂停的");
      assert.equal(runtime.dueTaskRuns("turn").some((due) => due.taskId === task.id), false);
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("重复添加不重装配方，也不产生第二份定时任务", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-idempotent-"));
  const store = new AssistantBotStore(":memory:");
  try {
    const runtime = runtimeAt(dir);
    const template = templateWithRecipe();
    const recipe = normalizeBotRecipe(template.recipe, runtime.listAbilities().map((item) => item.id));
    const consent = {
      token: recipeConsentToken({ templateId: template.id, templateVersion: template.version, recipe }),
      skills: recipe.skills.map((item) => item.key),
      routines: recipe.routines.map((item) => item.key),
    };
    const first = store.importTemplate("me", { id: template.id, version: template.version, consent }, hostOf(runtime));
    const taskCount = runtime.snapshot().tasks.length;
    const skillCount = runtime.listAbilities().length;

    const again = store.importTemplate("me", { id: template.id, version: template.version, consent }, hostOf(runtime));
    assert.equal(again.id, first.id);
    assert.equal(runtime.snapshot().tasks.length, taskCount);
    assert.equal(runtime.listAbilities().length, skillCount);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("编辑 Bot 不会丢掉落地收据，请求体也无法伪造它", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-receipt-"));
  const store = new AssistantBotStore(":memory:");
  try {
    const runtime = runtimeAt(dir);
    const template = templateWithRecipe();
    const recipe = normalizeBotRecipe(template.recipe, runtime.listAbilities().map((item) => item.id));
    const bot = store.importTemplate("me", {
      id: template.id,
      version: template.version,
      consent: {
        token: recipeConsentToken({ templateId: template.id, templateVersion: template.version, recipe }),
        skills: recipe.skills.map((item) => item.key),
      },
    }, hostOf(runtime));
    const original = bot.recipeReceipt;
    assert.ok(original);

    const edited = store.save("me", { ...bot, name: "我的项目助理", instructions: "我的规则", recipeReceipt: { templateId: "forged" } });
    assert.equal(edited.name, "我的项目助理");
    assert.deepEqual(edited.recipeReceipt, original);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("没有宿主的入口拒绝安装配方内容，而不是静默跳过", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-recipe-nohost-"));
  const store = new AssistantBotStore(":memory:");
  try {
    const runtime = runtimeAt(dir);
    const template = templateWithRecipe();
    const recipe = normalizeBotRecipe(template.recipe, runtime.listAbilities().map((item) => item.id));
    assert.throws(() => store.importTemplate("me", {
      id: template.id,
      version: template.version,
      consent: {
        token: recipeConsentToken({ templateId: template.id, templateVersion: template.version, recipe }),
        skills: recipe.skills.map((item) => item.key),
      },
    }), /无法安装/);
    // 拒绝发生在写入之前：不该留下一个半成品 Bot。
    assert.deepEqual(store.list("me").filter((item) => item.template?.id === template.id), []);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
