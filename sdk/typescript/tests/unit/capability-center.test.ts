import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

const NEW_CAPABILITIES = [
  "research-brief",
  "market-briefing",
  "presentation-builder",
  "thinking-workbench",
  "product-design",
  "business-deal",
  "market-opportunity",
  "ability-builder",
  "project-development",
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
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-center-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "测试交付\n\n交付完成。", facts: [] }),
    });
    const abilityIds = new Set(runtime.snapshot().abilities.map((ability) => ability.id));
    for (const id of NEW_CAPABILITIES) assert.ok(abilityIds.has(id), `missing ${id}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("单次能力任务只使用偏好记忆或完全关闭召回", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-memory-"));
  const receivedMemoryModes: Array<"default" | "preferences" | "off" | undefined> = [];
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async (_personaId, _text, _signal, _limits, _runId, memoryMode) => {
        receivedMemoryModes.push(memoryMode);
        return { reply: THINKING_RESULT, facts: [] };
      },
    });
    await runtime.runAdHocTask({
      title: "只参考习惯的任务",
      personaId: "clownfish",
      capabilityId: "thinking-workbench",
      instruction: "整理问题",
      memoryMode: "preferences",
    });
    await runtime.runAdHocTask({
      title: "不参考习惯的任务",
      personaId: "clownfish",
      capabilityId: "thinking-workbench",
      instruction: "整理问题",
      memoryMode: "off",
    });
    assert.deepEqual(receivedMemoryModes, ["preferences", "off"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("开发项目作为独立能力执行，并保存可继续交接的完整结果", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-development-capability-"));
  const workspace = mkdtempSync(join(tmpdir(), "clownfish-development-workspace-"));
  let received: { workspacePath: string; instruction: string; accessMode: string } | undefined;
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => { throw new Error("开发能力不应走普通角色回复"); },
      runDeveloper: async (input) => {
        received = { workspacePath: input.workspacePath, instruction: input.instruction, accessMode: input.accessMode };
        return { reply: "已完成项目修改。\n\n测试通过。", workspacePath: input.workspacePath, accessMode: input.accessMode, changedFiles: ["src/app.ts"], fileReceipts: [{ path: "src/app.ts", state: "present", sha256: "a".repeat(64), byteLength: 120 }], checks: [{ command: "npm_test", passed: true, output: "通过", checkedAt: "2026-08-06T00:00:00.000Z" }], unverifiedRisks: [], proposal: { id: "devprop-test", state: "pending", files: [{ path: "src/app.ts", operation: "update", proposedHash: "a".repeat(64), byteLength: 120 }] }, toolCalls: 3 };
      },
    });
    const notification = await runtime.runAdHocTask({
      title: "修复项目",
      personaId: "clownfish",
      capabilityId: "project-development",
      instruction: "修复页面跳动，并运行测试。",
      workspacePath: workspace,
      accessMode: "develop",
    });
    assert.deepEqual(received, { workspacePath: workspace, instruction: "修复页面跳动，并运行测试。", accessMode: "develop" });
    const handoff = runtime.artifactHandoff(notification.artifact.id);
    assert.equal(handoff?.text, "已完成项目修改。\n\n测试通过。");
    assert.equal(notification.artifact.proof?.level, "validated");
    assert.equal(notification.artifact.metadata?.development?.checks[0]?.command, "npm_test");
    assert.equal(notification.artifact.metadata?.development?.proposal?.state, "pending");
    assert.equal(runtime.updateDevelopmentProposalState("devprop-test", "applied")?.metadata?.development?.proposal?.state, "applied");
    assert.equal(new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "", facts: [] }) }).snapshot().artifacts[0]?.metadata?.development?.proposal?.state, "applied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("生成能力更新时递增版本、记录内容指纹并保留可回滚快照", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-lifecycle-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "完成", facts: [] }),
    });
    const first = runtime.learnFromWork({ personaId: "clownfish", name: "周报整理", description: "整理周报", goal: "整理本周进展", learnedKey: "weekly-report" });
    const skillFile = runtime.auditSkills().items.find((item) => item.abilityId === first.id)?.skillFile;
    assert.ok(skillFile);
    const firstManifest = JSON.parse(readFileSync(join(dirname(skillFile!), "manifest.json"), "utf8")) as Record<string, unknown>;
    assert.equal(firstManifest.version, "0.1.0");

    runtime.learnFromWork({ personaId: "clownfish", name: "周报整理", description: "整理项目周报", goal: "整理本周项目进展和风险", learnedKey: "weekly-report" });
    const secondManifest = JSON.parse(readFileSync(join(dirname(skillFile!), "manifest.json"), "utf8")) as { version: string; integrity: { contentHash: string; byteLength: number }; rollback: { previousVersion: string; historyPath: string } };
    assert.equal(secondManifest.version, "0.1.1");
    assert.match(secondManifest.integrity.contentHash, /^[a-f0-9]{64}$/);
    assert.ok(secondManifest.integrity.byteLength > 100);
    assert.equal(secondManifest.rollback.previousVersion, "0.1.0");
    assert.ok(existsSync(join(dirname(skillFile!), secondManifest.rollback.historyPath, "SKILL.md")));
    assert.ok(existsSync(join(dirname(skillFile!), secondManifest.rollback.historyPath, "manifest.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("长期任务脉络会保存进展、专家职责、决定替代关系和协作记录", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-task-storyline-"));
  try {
    const options = {
      dataDir: dir,
      personas: () => [
        { id: "clownfish", name: "小丑鱼" },
        { id: "product_lead", name: "产品顾问", tag: "做取舍与体验", expert: true },
      ],
      notify: async () => ({ reply: "测试交付\n\n交付完成。", facts: [] }),
    };
    const runtime = new CapabilityRuntime(options);
    const task = runtime.createTask({
      title: "改进新用户体验",
      personaId: "clownfish",
      capabilityId: "product-design",
      instruction: "梳理并验证首次使用路径",
    });
    runtime.updateTaskStoryline({
      id: task.id,
      status: "active",
      summary: "已经确认入口过重。",
      nextAction: "完成轻量首页原型。",
      experts: [{ personaId: "product_lead", responsibility: "负责产品取舍和首次体验复核" }],
    });
    const first = runtime.recordTaskDecision({ id: task.id, text: "首页不直接展示项目结构" });
    const firstDecision = first.storyline.decisions[0];
    runtime.recordTaskDecision({
      id: task.id,
      text: "首页只保留对话入口，任务从工作页进入",
      supersedesId: firstDecision.id,
    });

    const reloaded = new CapabilityRuntime(options);
    const saved = reloaded.snapshot().tasks.find((item) => item.id === task.id);
    assert.ok(saved);
    assert.equal(saved.storyline.summary, "已经确认入口过重。");
    assert.equal(saved.storyline.nextAction, "完成轻量首页原型。");
    assert.deepEqual(saved.storyline.experts, [{ personaId: "product_lead", responsibility: "负责产品取舍和首次体验复核" }]);
    assert.equal(saved.storyline.decisions[0].status, "active");
    assert.equal(saved.storyline.decisions[1].status, "superseded");
    assert.ok(saved.storyline.events.some((item) => item.type === "decision"));
    assert.equal(reloaded.snapshot().personas.find((item) => item.id === "product_lead")?.expert, true);
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
  assert.equal([...script.matchAll(/backendId:/g)].length, 13);
  assert.match(script, /memoryMode:[^\n]+"preferences"/);
  assert.match(script, /\/api\/agent\/job/);
  assert.match(html, /id="capabilityPicker"/);
  assert.match(html, /class="task-advanced"/);
  assert.doesNotMatch(html, /id="recentStrip"|id="recentTask"/);
  assert.match(script, /name: "做 PPT"/);
  assert.match(script, /name: "深度研究"/);
  assert.match(script, /name: "查港股资料"/);
  assert.match(script, /name: "生成新能力"/);
  assert.match(script, /name: "开发项目"/);
  assert.match(html, /id="workspaceInput"/);
  assert.match(html, /id="recentWorkspacePaths"/);
  assert.match(html, /id="useRecentWorkspace"/);
  assert.match(script, /clownfish-recent-workspaces-v1/);
  assert.match(html, /id="accessModeSelect"/);
  assert.match(html, /开发模式会运行项目自带的测试或构建脚本/);
  assert.match(html, /只读检查不会运行这些脚本/);
  assert.doesNotMatch(html, /personaSelect|由谁完成/);
  assert.doesNotMatch(script, /personaSelect/);
  assert.match(script, /personaId: "clownfish"/);
  assert.match(script, /项目修改、可运行结果与验证记录/);
  assert.match(script, /format: "pptx"/);
  assert.match(script, /name: "写正式文档"/);
  assert.match(html, /class="rail-secondary" href="\/#settings"/);
  assert.doesNotMatch(html, /class="rail-memory"/);
  assert.doesNotMatch(`${html}\n${script}`, /github\.com|plugin:\/\//i);
});

test("对话和能力页面共享目标、执行状态与返回路径", () => {
  const webDir = join(process.cwd(), "examples", "companion", "web");
  const chatHtml = readFileSync(join(webDir, "index.html"), "utf8");
  const capabilityHtml = readFileSync(join(webDir, "capabilities.html"), "utf8");
  const capabilityScript = readFileSync(join(webDir, "assets", "capability-center.js"), "utf8");
  const serverSource = readFileSync(join(process.cwd(), "examples", "companion", "server.ts"), "utf8");

  assert.match(chatHtml, /id="composerCapability"/);
  assert.match(chatHtml, /\$\("#railCap"\)\.onclick = \(\) => \{ window\.location\.href = "\/capabilities"; \};/);
  assert.match(chatHtml, /\$\("#composerCapability"\)\.onclick = \(\) => openCapabilityPanel\(\{ includeDraft: true \}\);/);
  assert.doesNotMatch(chatHtml, /\$\("#railCap"\)\.onclick = openCapabilityPanel/);
  assert.match(chatHtml, /id="chatCapabilityBridge"/);
  assert.match(chatHtml, /function renderChatCapabilityBridge/);
  assert.match(chatHtml, /dataset\.viewTarget = completed \? "history" : "runs"/);
  assert.match(chatHtml, /value\.trim\(\)\.slice\(0, 2000\)/);
  assert.match(chatHtml, /sourceMessages/);
  assert.match(chatHtml, /conversationKey/);
  assert.match(chatHtml, /【用户已经说明】/);
  assert.match(chatHtml, /【对话中已有的分析与结论】/);
  assert.match(capabilityHtml, /id="chatContext"/);
  assert.match(capabilityHtml, /id="runConversationBridge"/);
  assert.match(capabilityScript, /function applyChatHandoff/);
  assert.match(capabilityScript, /fromChat = handoff\.source === "chat"/);
  assert.match(capabilityScript, /chatContext"\)\.hidden = !fromChat/);
  assert.match(capabilityScript, /sessionStorage\.removeItem\(HANDOFF_KEY\)/);
  assert.match(capabilityScript, /handoffContext/);
  assert.match(capabilityScript, /handoffSummary/);
  assert.match(capabilityScript, /function loadHandoffConversation/);
  assert.match(capabilityScript, /clownfish-conversation-trees-v1/);
  assert.match(capabilityScript, /handoffConversation/);
  assert.match(capabilityScript, /sourceMessageId/);
  assert.match(capabilityScript, /subjectId/);
  assert.match(serverSource, /renderCapabilityHandoffContext/);
  assert.match(serverSource, /handoffReceipt/);
  assert.match(capabilityScript, /conversationKey: state\.returnConversationKey/);
  assert.match(serverSource, /conversationKey: String\(job\.payload\.conversationKey/);
  assert.match(serverSource, /capabilityPersonaId = body\.kind === "capability-adhoc" \? "clownfish"/);
  assert.match(capabilityScript, /clownfish-capability-activity-v1/);
  assert.match(capabilityScript, /在对话中查看/);
  assert.match(capabilityScript, /function handoffJob/);
  assert.match(capabilityScript, /artifact\/context/);
  assert.match(capabilityScript, /parentJobId/);
  assert.match(capabilityScript, /function jobMemoryUsage/);
  assert.match(capabilityScript, /appliedPreferences/);
  assert.match(capabilityScript, /\/office\?artifact=/);
  assert.match(serverSource, /previewDeliveryPreferences/);
  assert.match(serverSource, /pinnedPreferenceContext/);
  assert.match(serverSource, /memoryMode: pinnedPreferenceContext \? "off" : requestedMemoryMode/);
});

test("工作页以任务脉络展示长期进展，聊天仍保持小丑鱼单一入口", () => {
  const webDir = join(process.cwd(), "examples", "companion", "web");
  const workHtml = readFileSync(join(webDir, "work.html"), "utf8");
  const workScript = readFileSync(join(webDir, "assets", "work-center.js"), "utf8");
  const chatHtml = readFileSync(join(webDir, "index.html"), "utf8");

  assert.match(workHtml, /id="storyDialog"/);
  assert.match(workHtml, /任务脉络/);
  assert.match(workHtml, /专家职责/);
  assert.match(workHtml, /关键决定/);
  assert.match(workScript, /\/api\/capabilities\/task\/storyline/);
  assert.match(workScript, /\/api\/capabilities\/task\/decision/);
  assert.match(workScript, /data-open-story/);
  assert.match(workHtml, /id="taskCapability" required/);
  assert.match(workScript, /请选择能力/);
  assert.doesNotMatch(workScript, /memoryArchiveExpanded|data-toggle-archive|原始归档/);
  assert.match(workScript, /这里只显示小丑鱼整理出的事实、经历与习惯/);
  assert.doesNotMatch(chatHtml, /协作进度|executionPanel/);
  assert.doesNotMatch(workHtml, /专家群聊|大群/);
});

test("选择能力后直接进入填写和执行，不再经过准备能力步骤", () => {
  const webDir = join(process.cwd(), "examples", "companion", "web");
  const html = readFileSync(join(webDir, "capabilities.html"), "utf8");
  const script = readFileSync(join(webDir, "assets", "capability-center.js"), "utf8");

  assert.match(html, /直接选择能力/);
  assert.match(html, /class="capability-picker" id="capabilityPicker"/);
  assert.match(html, /id="launchPanel"/);
  assert.match(html, /自动选择能力/);
  assert.match(html, /class="catalog-or">或<\/p>/);
  assert.match(readFileSync(join(webDir, "assets", "capability-center.css"), "utf8"), /\.hero h1, \.catalog-or \{ font-size: 27px; \}/);
  assert.doesNotMatch(html, /id="toggleAll"|常用能力|再次使用/);
  assert.match(script, /CATALOG\.slice\(0, 20\)/);
  assert.doesNotMatch(script, /showAll|RECENT_KEY|data-reuse-job|function reuseJob/);
  assert.match(html, /id="closeLaunch">更换能力/);
  assert.match(html, /class="launch-submit-row"/);
  assert.match(script, /data-capability[\s\S]*activateCapability/);
  assert.match(script, /focusInput: true/);
  assert.match(script, /classList\.add\("is-launching"\)/);
  assert.match(script, /button\.disabled = !status\.ready \|\| !hasInstruction \|\| !hasWorkspace/);
  assert.match(script, /查看修改/);
  assert.match(script, /data-apply-proposal/);
  assert.match(script, /data-reject-proposal/);
  assert.match(script, /修改先作为提案保存/);
  assert.match(script, /const ICON_TONES =/);
  assert.match(script, /function artifactDisplayTitle/);
  assert.match(script, /function updateLaunchState\(\)/);
  assert.doesNotMatch(html, /picker-action/);
  assert.doesNotMatch(html, /任务摘要|开始前检查|previewSheet|task-preview|readiness-list/);
  assert.doesNotMatch(`${html}\n${script}`, /prepareSelected|flow-steps|帮我准备|准备这个能力|准备：/);
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

test("常规任务的界面状态由持久作业投影，且重启后仍可恢复", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-task-execution-"));
  try {
    const options = {
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "完成", facts: [] }),
    };
    const runtime = new CapabilityRuntime(options);
    const task = runtime.createTask({
      title: "真实状态任务",
      personaId: "clownfish",
      capabilityId: "document-draft",
      instruction: "整理资料",
    });
    runtime.projectTaskExecution({
      taskId: task.id,
      jobId: "job-1",
      status: "running",
      progress: 35,
      label: "正在读取材料",
      updatedAt: "2026-08-06T10:00:00.000Z",
    });
    const restored = new CapabilityRuntime(options).snapshot().tasks.find((item) => item.id === task.id);
    assert.deepEqual(restored?.execution, {
      jobId: "job-1",
      status: "running",
      progress: 35,
      label: "正在读取材料",
      updatedAt: "2026-08-06T10:00:00.000Z",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
