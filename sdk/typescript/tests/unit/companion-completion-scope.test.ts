import { readAppHtml } from "../fixtures/render-app-page.js";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { appRoute } from "../../examples/companion/app-navigation.js";

test("工作分区恢复各自入口，自动化、项目、资料、成果和记忆深链接可用", () => {
  const root = join(process.cwd(), "examples", "companion", "web");
  const html = readAppHtml("work.html");
  const script = readFileSync(join(root, "assets", "work-center.js"), "utf8");
  const stability = readFileSync(join(root, "assets", "work-stability.css"), "utf8");
  const chat = readAppHtml("index.html");
  const server = readServerRouteSurface();
  const capabilityHtml = readAppHtml("capabilities.html");
  const capabilityScript = readFileSync(join(root, "assets", "capability-center.js"), "utf8");

  assert.match(html, /href="\/automations"/);
  assert.match(html, /href="\/tasks"/);
  assert.match(script, /function renderArtifacts/);
  assert.match(script, /function renderRuns/);
  assert.match(script, /function renderMemory/);
  const routing = script.match(/const viewFromLocation = \(\) => (.+);/);
  assert.ok(routing);
  const route = new Function("window", `return (${routing[1]});`);
  for (const name of ["tasks","spaces","automations","collaboration","resources","artifacts","runs","memory"]) {
    const resolved = appRoute("/"+name);
    assert.ok(resolved && "workView" in resolved);
    assert.equal(route({ClownfishNavigation:{workView:()=>resolved.workView}}), name);
  }
  assert.equal(appRoute("/develop"), undefined);
  assert.match(html, /\/assets\/agent-events\.js/);
  assert.match(script, /renderAttentionInbox\(false\)/);
  assert.match(html, /data-view="tasks">任务记录/);
  assert.doesNotMatch(html, /id="projectsViewLink"/);
  assert.match(html, /data-view="(?:collaboration|resources|artifacts|runs|memory)"/);
  assert.match(script, /\/api\/memory\/preference/);
  assert.match(script, /\/api\/memory\/forget/);
  assert.match(script, /\/api\/memory\/correct/);
  assert.match(script, /data-memory-detail/);
  assert.match(html, /memoryDetailDialog/);
  assert.match(server, /\/api\/memory\/correct/);
  assert.match(server, /sourceMessageId[\s\S]*archivalId[\s\S]*excerpt/);
  assert.match(script, /\/api\/capabilities\/artifact\/feedback/);
  assert.match(script, /history\.pushState/);
  assert.match(script, /window\.addEventListener\("popstate"/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(stability, /scrollbar-gutter:\s*stable/);
  assert.match(stability, /display:\s*flow-root/);
  assert.match(chat, /clownfish-conversation-trees-v20260813b/);
  assert.match(chat, /clownfish-chat-logs-v20260813b/);
  assert.match(chat, /conversationRequestOptions/);
  assert.match(chat, /workMode: normalizeWorkMode/);
  assert.match(chat, /#contacts"\)\.addEventListener\("click"/);
  assert.match(chat, /\.contact\[data-conversation-id\]/);
  assert.doesNotMatch(chat, /querySelector\("\.contact-open"\)\.onclick/);
  assert.match(server, /body\.workMode === "task" \|\| body\.workMode === "study"/);
  assert.match(server, /systemAddendum: body\.workMode === "study"/);
  assert.match(server, /teacherCore\.split\("\\n\\n"\)\.slice\(1\)/);
  // 断言端点存在，不绑定具体匹配写法：路由已从 if 链搬进路由表。
  assert.match(server, /"\/api\/conversation\/title"/);
  assert.match(server, /function generateConversationTitle\(text: string\)/);
  assert.match(server, /dailyChatModelForConnection\(modelConnection\)/);
  assert.match(server, /toolMode: "off"/);
  assert.doesNotMatch(chat, /协作进度|executionPanel/);
  assert.match(chat, /function splitStreamMessages/);
  assert.match(chat, /function isSubstantialAssistantLongform/);
  assert.match(chat, /function collapseStreamLongform/);
  assert.match(chat, /run\.length > 1 && isSubstantialAssistantLongform\(combined\)/);
  assert.match(chat, /STREAM_MESSAGE_REVEAL_DELAY_MS = 180/);
  assert.match(chat, /await revealChain/);
  assert.doesNotMatch(`${capabilityHtml}\n${capabilityScript}`, /project-development|developmentProgress|developmentReceipt|data-access-mode/);
});

test("技能支持固定、停用、陈旧与证据写回", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skill-lifecycle-"));
  try {
    const runtime = new CapabilityRuntime({
      dataDir: dir,
      personas: () => [{ id: "clownfish", name: "小丑鱼" }],
      notify: async () => ({ reply: "# 结果\n\n可以使用。", facts: [] }),
    });
    const ability = runtime.createGeneratedAbility({
      personaId: "clownfish",
      name: "验证流程",
      goal: "按固定步骤生成可检查结果",
      defaultFormat: "md",
    });
    runtime.setAbilityLifecycle(ability.id, "pin");
    assert.equal(runtime.auditSkills().items.find((item) => item.abilityId === ability.id)?.state, "pinned");
    runtime.setAbilityLifecycle(ability.id, "stale");
    runtime.setAbilityLifecycle(ability.id, "disable");
    await assert.rejects(() => runtime.runAdHocTask({
      title: "停用检查",
      personaId: "clownfish",
      capabilityId: ability.id,
      instruction: "执行",
    }), /已停用/);

    runtime.setAbilityLifecycle(ability.id, "enable");
    const notification = await runtime.runAdHocTask({
      title: "证据检查",
      personaId: "clownfish",
      capabilityId: ability.id,
      instruction: "执行",
    });
    const feedback = runtime.recordArtifactFeedback({ artifactId: notification.artifact.id, outcome: "useful", note: "这个步骤已验证可用", applyToSkill: true });
    assert.equal(feedback.applied, true);
    const audit = runtime.auditSkills().items.find((item) => item.abilityId === ability.id);
    assert.equal(audit?.positiveEvidence, 1);
    assert.match(readFileSync(audit!.skillFile, "utf8"), /已验证经验[\s\S]*这个步骤已验证可用/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("实时动车、航班、酒店和餐馆适配器被明确排除", () => {
  const roadmap = readFileSync(join(process.cwd(), "examples", "companion", "capability-roadmap.ts"), "utf8");
  assert.match(roadmap, /travel-adapter[\s\S]*status: "excluded"/);
  assert.match(roadmap, /hotel-restaurant-adapter[\s\S]*status: "excluded"/);
});
