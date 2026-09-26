import assert from "node:assert/strict";
import test from "node:test";
import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import { filterCompanionRuntimeToolsForSurface } from "../../examples/companion/capability-system-registry.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";

const chat: ChatAgentContext = { sessionId: "conversation-1", userId: "me", personaId: "clownfish", instruction: "", scope: "conv:me:clownfish", memoryScopes: ["conv:me:clownfish"], mode: "chat", surface: "task" };
const names = (tools: ReadonlyArray<{ definition: { name: string } }>) => tools.map((tool) => tool.definition.name);
const run = { signal: new AbortController().signal, runId: "r", sessionId: "conversation-1" };

function fixture() {
  const saved: string[] = [];
  let current = "小丑鱼";
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime),
    renamePersona: (name) => { const previous = current; current = name; saved.push(name); return { previous, name }; } });
  return { provider, saved };
}

// 真实使用里：聊天里说"以后叫你阿福"，模型没有能改名的工具，只能嘴上答应。
test("聊天里说要给它改名才给改名工具；别的角色、能力页、只问名字都拿不到；能过界面过滤；写入要批准", async () => {
  const { provider } = fixture();
  for (const text of ["以后叫你阿福吧", "给你起个名字，叫小鱼", "我想给你换个名字"]) assert.ok(names(await provider(text, chat)).includes("persona_rename"), text);
  assert.deepEqual(names(await provider("你叫什么名字", chat)), []);
  assert.deepEqual(names(await provider("以后叫你阿福", { ...chat, personaId: "teacher_lin" })), []);
  assert.deepEqual(names(await provider("以后叫你阿福", { ...chat, surface: "capability" })), []);
  const tools = await provider("以后叫你阿福", chat);
  assert.ok(names(filterCompanionRuntimeToolsForSurface("task", tools)).includes("persona_rename"), "没登记会被界面过滤丢掉");
  assert.equal(tools.find((tool) => tool.definition.name === "persona_rename")!.definition.effect, "write");
});

test("改名：去掉首尾空白后保存，结果说清只改自称；空的、太长、带换行或尖括号、全是标点的拒绝", async () => {
  const { provider, saved } = fixture();
  const rename = (await provider("以后叫你阿福", chat)).find((tool) => tool.definition.name === "persona_rename")!;
  const result = JSON.parse((await rename.execute({ name: "  阿福 " }, run)).content);
  assert.deepEqual(saved, ["阿福"]);
  assert.deepEqual([result.previous, result.name], ["小丑鱼", "阿福"]);
  assert.match(result.note, /应用名仍是「小丑鱼」/);
  for (const bad of ["", "   ", "一二三四五六七八九十一二三", "阿\n福", "<b>福</b>", "！！！"]) {
    await assert.rejects(rename.execute({ name: bad }, run), /名字/, JSON.stringify(bad));
  }
  assert.deepEqual(saved, ["阿福"], "拒绝的不落盘");
});
