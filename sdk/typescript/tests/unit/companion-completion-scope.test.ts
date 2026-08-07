import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

test("工作页提供任务、结果、运行和记忆的独立新手入口", () => {
  const root = join(process.cwd(), "examples", "companion", "web");
  const html = readFileSync(join(root, "work.html"), "utf8");
  const script = readFileSync(join(root, "assets", "work-center.js"), "utf8");
  const stability = readFileSync(join(root, "assets", "work-stability.css"), "utf8");
  const chat = readFileSync(join(root, "index.html"), "utf8");
  const server = readFileSync(join(process.cwd(), "examples", "companion", "server.ts"), "utf8");
  const capabilityHtml = readFileSync(join(root, "capabilities.html"), "utf8");
  const capabilityScript = readFileSync(join(root, "assets", "capability-center.js"), "utf8");

  for (const route of ["/tasks", "/artifacts", "/runs", "/memory"]) {
    assert.match(html + script + chat, new RegExp(route.replace("/", "\\/")));
  }
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
  assert.match(chat, /clownfish-conversation-trees-v1/);
  assert.match(chat, /branchConversation/);
  assert.match(chat, /rollbackConversation/);
  assert.match(chat, /conversationRequestOptions/);
  assert.doesNotMatch(chat, /协作进度|executionPanel/);
  assert.match(chat, /function splitStreamMessages/);
  assert.match(chat, /STREAM_MESSAGE_REVEAL_DELAY_MS = 180/);
  assert.match(chat, /await revealChain/);
  assert.match(capabilityHtml, /像和开发同事交代事情一样描述即可/);
  assert.match(capabilityHtml, /data-access-mode="develop"[\s\S]*data-access-mode="inspect"/);
  assert.match(capabilityScript, /function developmentProgress/);
  assert.match(capabilityScript, /function developmentReceipt/);
  assert.match(capabilityScript, /继续调整/);
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
