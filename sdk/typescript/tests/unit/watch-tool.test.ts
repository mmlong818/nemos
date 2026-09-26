import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import { filterCompanionRuntimeToolsForSurface } from "../../examples/companion/capability-system-registry.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";
import { WATCH_LIMITS, WatchStore } from "../../examples/companion/watch.js";

function fixture(t: TestContext, searchReady = true) {
  const dir = mkdtempSync(join(tmpdir(), "watch-tool-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const store = new WatchStore(join(dir, "watch.json"));
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime), watch: () => ({ store, searchReady: () => searchReady }) });
  return { store, provider };
}
const chat: ChatAgentContext = { sessionId: "conversation-1", userId: "me", personaId: "clownfish", instruction: "", scope: "conv:me:clownfish", memoryScopes: ["conv:me:clownfish"], mode: "chat", surface: "task" };
const names = (tools: ReadonlyArray<{ definition: { name: string } }>) => tools.map((tool) => tool.definition.name);
const run = { signal: new AbortController().signal, runId: "r", sessionId: "conversation-1" };

test("聊天里说'帮我盯着'才给盯着工具；闲聊、别的角色、能力页拿不到；能通过界面过滤；写入要批准", async (t) => {
  const { provider } = fixture(t);
  for (const text of ["帮我盯着赵雷巡演成都站什么时候开票", "iPhone 18 有新消息告诉我", "留意一下这家店有没有降价的动静"]) {
    assert.ok(names(await provider(text, chat)).includes("watch_add"), text);
  }
  assert.deepEqual(names(await provider("今天有点累", chat)), []);
  assert.deepEqual(names(await provider("帮我盯着开票", { ...chat, personaId: "teacher_lin" })), []);
  assert.deepEqual(names(await provider("帮我盯着开票", { ...chat, surface: "capability" })), []);
  const tools = await provider("帮我盯着开票", chat);
  assert.ok(names(filterCompanionRuntimeToolsForSurface("task", tools)).includes("watch_add"), "没登记的工具会被界面过滤整批丢掉");
  assert.equal(tools.find((tool) => tool.definition.name === "watch_add")!.definition.effect, "write");
});

test("加一件：打开开关、可改间隔、同一件不重复、超过上限如实报错；没配联网搜索时如实说不会运行", async (t) => {
  const { store, provider } = fixture(t);
  const add = (await provider("帮我盯着", chat)).find((tool) => tool.definition.name === "watch_add")!;
  const first = JSON.parse((await add.execute({ text: "赵雷巡演成都站开票", intervalHours: 6 }, run)).content);
  assert.deepEqual(store.snapshot().items.map((i) => i.text), ["赵雷巡演成都站开票"]);
  assert.equal(store.snapshot().enabled, true);
  assert.equal(store.snapshot().intervalMinutes, 360);
  assert.deepEqual(first.watching, ["赵雷巡演成都站开票"]);
  assert.equal(first.intervalHours, 6);
  assert.match(first.note, /只在应用开着时/);
  // 真实使用里模型说了"有新动静我第一时间告诉你"：结果里要带转告要求。
  assert.match(first.replyRule, /不要说"第一时间"/);
  await add.execute({ text: "赵雷巡演成都站开票" }, run);
  assert.equal(store.snapshot().items.length, 1, "同一件不重复加");
  for (let i = 2; i <= WATCH_LIMITS.items; i++) await add.execute({ text: `第 ${i} 件` }, run);
  await assert.rejects(add.execute({ text: "再多一件" }, run), /最多盯 5 件事/);
  await assert.rejects(add.execute({ text: "x", intervalHours: 48 }, run), /1 到 24 小时/);

  const offline = fixture(t, false);
  const addOffline = (await offline.provider("帮我盯着", chat)).find((tool) => tool.definition.name === "watch_add")!;
  const note = JSON.parse((await addOffline.execute({ text: "开票" }, run)).content).note;
  assert.match(note, /联网搜索没有配置.*不会运行/);
});
