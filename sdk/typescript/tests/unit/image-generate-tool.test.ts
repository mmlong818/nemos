import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Nemos } from "../../src/index.js";
import type { CapabilityArtifact, CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import { filterCompanionRuntimeToolsForSurface } from "../../examples/companion/capability-system-registry.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

const chat: ChatAgentContext = { sessionId: "conversation-1", userId: "me", personaId: "clownfish", instruction: "", scope: "conv:me:clownfish", memoryScopes: ["conv:me:clownfish"], mode: "chat", surface: "task" };
const names = (tools: ReadonlyArray<{ definition: { name: string } }>) => tools.map((tool) => tool.definition.name);
const run = { signal: new AbortController().signal, runId: "r", sessionId: "conversation-1" };

function fixture(available = true) {
  const calls: Array<{ prompt: string; size?: string; quality?: string }> = [];
  const provider = createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities: () => ({} as CapabilityRuntime),
    imageGeneration: {
      available: () => available,
      create: async (prompt, options) => {
        calls.push({ prompt, ...options });
        return { id: "artifact-1", title: prompt.slice(0, 80), format: "png", file: "C:\secret\artifact-1.png" } as CapabilityArtifact;
      },
    } });
  return { provider, calls };
}

// 聊天里说"画一张图"，以前模型手里没有能出图的工具，只能用文字描述一张图。
test("说要画图、且有验证过的生图型号时才给生图工具；能过界面过滤；执行要批准", async () => {
  const { provider } = fixture();
  for (const text of ["帮我画一张小丑鱼的插画", "生成一张海报，主题是秋天", "给我做个头像", "draw a clownfish logo"]) {
    assert.ok(names(await provider(text, chat)).includes("image_generate"), text);
  }
  for (const text of ["这张图里写了什么", "今天天气怎么样"]) assert.ok(!names(await provider(text, chat)).includes("image_generate"), text);
  assert.ok(!names(await provider("画一张图", { ...chat, personaId: "teacher_lin" })).includes("image_generate"), "只给小丑鱼");
  assert.ok(!names(await provider("画一张图", { ...chat, mode: "group" })).includes("image_generate"), "群聊不给");
  assert.ok(!names(await fixture(false).provider("画一张图", chat)).includes("image_generate"), "没有验证过的生图型号就不给，免得模型答应了却画不出");
  const tools = await provider("画一张图", chat);
  assert.ok(names(filterCompanionRuntimeToolsForSurface("task", tools)).includes("image_generate"), "没登记会被界面过滤丢掉");
  assert.equal(tools.find((tool) => tool.definition.name === "image_generate")!.definition.effect, "write", "每次都花钱，要先批准");
});

test("生图：把描述和尺寸交给生成器，结果不带本机路径；空描述拒绝", async () => {
  const { provider, calls } = fixture();
  const tool = (await provider("画一张图", chat)).find((item) => item.definition.name === "image_generate")!;
  const result = await tool.execute({ prompt: "  一条橙色小丑鱼，水彩风格 ", size: "1536x1024" }, run);
  assert.deepEqual(calls, [{ prompt: "一条橙色小丑鱼，水彩风格", size: "1536x1024", quality: undefined }]);
  assert.equal(JSON.parse(result.content).generated, true);
  assert.doesNotMatch(result.content, /secret|\.png/, "不把本机路径交给模型");
  await assert.rejects(tool.execute({ prompt: "   " }, run), /图片描述/);
  assert.equal(calls.length, 1);
});

test("生成的图随这一轮回复交给前端，并显示成图片", () => {
  const server = readServerRouteSurface();
  const start = server.indexOf("const chatTurnArtifacts");
  assert.ok(start > 0);
  const wiring = server.slice(start, server.indexOf("personalWork: () => personalWork,", start));
  assert.ok(wiring.length > 200, "切片不能是空的");
  assert.match(wiring, /resolveMediaRoute\("image_generation"\)/, "只用设置里验证过的生图型号");
  assert.match(wiring, /capabilities\.saveGeneratedImage\(/, "图片进成果库");
  assert.match(wiring, /chatTurnArtifacts\.getStore\(\)\?\.push\(/);
  const stream = server.slice(server.indexOf('url === "/api/chat/stream"'), server.indexOf('url === "/api/chat"'));
  assert.match(stream, /chatTurnArtifacts\.run\(turnArtifacts, \(\) => engine\.sendStream\(/);
  assert.match(stream, /type: "done"[^\n]*turnArtifacts/);
  const plain = server.slice(server.indexOf('url === "/api/chat"'));
  assert.match(plain, /chatTurnArtifacts\.run\(turnArtifacts, \(\) => engine\.send\(/);
  const page = readFileSync(join(__dirname, "..", "..", "examples", "companion", "web", "index.html"), "utf8");
  assert.match(page, /image_generate: "生成图片"/, "审批卡上显示中文名称，不显示内部工具名");
  assert.match(page, /image_generate: "用设置里验证过的生图型号画一张图[^"]*费用"/, "审批卡说明写清会扣费");
  assert.match(page, /opts\.artifact\.format === "png"[\s\S]{0,400}\/api\/capabilities\/artifact\?id=/, "png 成果直接显示成图片");
});
