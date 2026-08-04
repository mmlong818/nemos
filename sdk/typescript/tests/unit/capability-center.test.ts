import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

const NEW_CAPABILITIES = [
  "research-brief",
  "presentation-builder",
  "thinking-workbench",
  "product-design",
  "business-deal",
  "market-opportunity",
  "ability-builder",
];

const THINKING_RESULT = JSON.stringify({
  kind: "thinking-workbench",
  title: "问题梳理",
  summary: "把问题拆成事实、假设、选择和验证。",
  data: {
    problem: "如何推进",
    facts: ["目标已知"],
    assumptions: [{ text: "用户愿意尝试", risk: "中" }],
    contradictions: [],
    options: [
      { name: "方案 A", upside: "快", downside: "范围小", signal: "一周内有反馈" },
      { name: "方案 B", upside: "完整", downside: "慢", signal: "验证通过" },
    ],
    experiments: [{ name: "小范围试用", method: "找三位用户", cost: "低", successSignal: "两位完成核心任务" }],
    nextActions: ["开始试用"],
  },
});

test("能力中心所需的内置能力可直接使用", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-capability-center-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "zhiwei", name: "知微" }],
      notify: async () => ({ reply: "测试交付\n\n交付完成。", facts: [] }),
    });
    const abilityIds = new Set(runtime.snapshot().abilities.map((ability) => ability.id));
    for (const id of NEW_CAPABILITIES) assert.ok(abilityIds.has(id), `missing ${id}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("单次能力任务只使用偏好记忆或完全关闭召回", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-capability-memory-"));
  const receivedMemoryModes: Array<"default" | "preferences" | "off" | undefined> = [];
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "zhiwei", name: "知微" }],
      notify: async (_personaId, _text, _signal, _limits, _runId, memoryMode) => {
        receivedMemoryModes.push(memoryMode);
        return { reply: THINKING_RESULT, facts: [] };
      },
    });
    await runtime.runAdHocTask({
      title: "只参考习惯的任务",
      personaId: "zhiwei",
      capabilityId: "thinking-workbench",
      instruction: "整理问题",
      memoryMode: "preferences",
    });
    await runtime.runAdHocTask({
      title: "不参考习惯的任务",
      personaId: "zhiwei",
      capabilityId: "thinking-workbench",
      instruction: "整理问题",
      memoryMode: "off",
    });
    assert.deepEqual(receivedMemoryModes, ["preferences", "off"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("能力中心页面包含完整任务闭环且没有外部项目痕迹", () => {
  const webDir = join(process.cwd(), "examples", "companion", "web");
  const html = readFileSync(join(webDir, "capabilities.html"), "utf8");
  const script = readFileSync(join(webDir, "assets", "capability-center.js"), "utf8");

  for (const view of ["start", "runs", "history", "files"]) {
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
  assert.equal([...script.matchAll(/backendId:/g)].length, 11);
  assert.match(script, /memoryMode:[^\n]+"preferences"/);
  assert.match(script, /\/api\/agent\/job/);
  assert.match(html, /id="capabilityPicker"/);
  assert.match(html, /class="task-advanced"/);
  assert.doesNotMatch(html, /id="recentStrip"|id="recentTask"/);
  assert.match(script, /name: "做 PPT"/);
  assert.match(script, /name: "深度研究"/);
  assert.match(script, /name: "生成新能力"/);
  assert.match(script, /format: "pptx"/);
  assert.match(script, /name: "写正式文档"/);
  assert.match(html, /class="rail-secondary" href="\/#settings"/);
  assert.doesNotMatch(html, /class="rail-memory"/);
  assert.doesNotMatch(`${html}\n${script}`, /github\.com|plugin:\/\//i);
});

test("Companion 主界面的弹窗和可点击列表具备基础无障碍语义", () => {
  const html = readFileSync(join(process.cwd(), "examples", "companion", "web", "index.html"), "utf8");
  const dialogIds = [
    "onboardingmodal", "memmodal", "groupmodal", "contactmodal", "settingsmenu", "toolsettingsmodal",
    "sourcemodal", "historymodal", "toolmodal", "personamodal", "avatarcropmodal", "hkmodal", "approvalmodal", "capmodal",
  ];
  for (const id of dialogIds) {
    assert.match(html, new RegExp(`<div id="${id}"[^>]*role="dialog"[^>]*aria-modal="true"`), `${id} should be an accessible dialog`);
  }
  assert.doesNotMatch(html, /<div class="smitem"/);
  assert.match(html, /<button class="smitem"/);
  assert.match(html, /role="tab" aria-selected="true"/);
  assert.match(html, /class="persona-advanced"/);
  assert.match(html, /<button type="button" class="history-row"/);
  assert.match(html, /id="contactSearch" type="search"/);
  assert.match(html, /id="composerTool"/);
  assert.doesNotMatch(html, /id="railDesktop"/);
  assert.match(html, /id="settingsbtn"[^>]*data-icon="settings"/);
});
