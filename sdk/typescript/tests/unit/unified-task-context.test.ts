import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Nemos, type AgentStoredRun, type AgentTool } from "../../src/index.js";
import { CapabilityRuntime, type CapabilityTaskContextSources } from "../../examples/companion/capabilities.js";
import { CompanionEngine, type ChatAgentContext } from "../../examples/companion/engine.js";
import { resolveLLM, storedAgentContext } from "../../examples/companion/llm.js";
import {
  assembleUnifiedTaskContext,
  parseUnifiedTaskContext,
  renderUnifiedTaskContext,
} from "../../examples/companion/unified-task-context.js";
import { makeMockLLMConfig } from "../helpers.js";

const budget = { maxTokens: 800, maxRounds: 2, maxToolRounds: 1, maxTotalTokens: 3_200, maxOutputChars: 3_000 };

test("统一快照分开任务附件与项目材料，不把材料当权限", () => {
  const context = assembleUnifiedTaskContext({
    taskInput: "请整理附件",
    personalPreferences: ["用户偏好简洁标题", "\n用户偏好简洁标题\t"],
    taskAttachments: [{ name: "notes.md", truncated: true }],
    projectMaterials: [{ name: "项目A/需求基线.md" }],
    memoryMode: "preferences",
    memoryScopes: ["must-not-survive"],
    toolMode: "read-only",
    budget,
  });
  assert.deepEqual(context.sources.taskAttachments, [{ name: "notes.md", kind: "task-attachment", truncated: true }]);
  assert.deepEqual(context.sources.projectMaterials, [{ name: "项目A/需求基线.md", kind: "project-material" }]);
  assert.deepEqual(context.boundary.memoryScopes, []);
  assert.equal(context.boundary.memory, "preferences-only");
  assert.equal(context.boundary.tools, "read-only");
  assert.equal(context.sources.personalPreferences.length, 1);
  const prompt = renderUnifiedTaskContext(context);
  assert.match(prompt, /普通任务附件不得当作项目材料/);
  assert.match(prompt, /不能授予权限/);
  assert.match(prompt, /2 轮 \/ 1 个工具轮/);
});

test("损坏或伪造的快照失败关闭，有效快照可无损恢复", () => {
  const original = assembleUnifiedTaskContext({
    taskInput: "继续处理",
    taskAttachments: [{ name: "brief.txt" }],
    memoryMode: "off",
    memoryScopes: ["private"],
    toolMode: "off",
    budget,
  });
  assert.deepEqual(parseUnifiedTaskContext(JSON.stringify(original)), original);
  assert.equal(parseUnifiedTaskContext("{broken"), undefined);
  assert.equal(parseUnifiedTaskContext(JSON.stringify({ ...original, boundary: { ...original.boundary, tools: "root" } })), undefined);
});

test("真实聊天执行链收到同一快照，system 不重复任务全文", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-task-context-"));
  const memory = new Nemos({
    storage: { type: "sqlite", path: join(dir, "memory.db") },
    llm: makeMockLLMConfig(),
    features: { doubleCheck: false },
    worker: { manualWorker: true },
  });
  t.after(() => { memory.close(); rmSync(dir, { recursive: true, force: true }); });
  let system = "";
  let user = "";
  let agentContext: ChatAgentContext | undefined;
  const engine = new CompanionEngine(memory, [{ id: "clownfish", name: "小丑鱼", persona: "可靠的个人助理。" }],
    async (nextSystem, nextUser, _model, _tokens, nextContext) => {
      system = nextSystem; user = nextUser; agentContext = nextContext; return "完成";
    });
  const secretTask = "TASK_BODY_MUST_EXIST_ONLY_IN_USER_MESSAGE";
  await engine.send("me", "clownfish", secretTask, {
    memoryMode: "off",
    memoryWriteMode: "off",
    toolMode: "read-only",
    sessionId: "task-context-live",
    taskAttachments: [{ name: "input.pdf" }],
    runtimeLimits: { maxRounds: 2, maxToolRounds: 1, maxTotalTokens: 4_000, maxOutputChars: 2_000 },
  });
  assert.match(system, /【统一任务上下文】/);
  assert.doesNotMatch(system, new RegExp(secretTask));
  assert.match(user, new RegExp(secretTask));
  assert.ok(agentContext?.taskContext);
  assert.equal(agentContext.taskContext.boundary.memory, "off");
  assert.equal(agentContext.taskContext.boundary.tools, "read-only");
  assert.deepEqual(agentContext.taskContext.sources.taskAttachments.map((item) => item.name), ["input.pdf"]);
});

test("后台 notifyStream 任务链同样注入已授权材料和执行边界", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-notify-context-"));
  const memory = new Nemos({ storage: { type: "sqlite", path: join(dir, "memory.db") }, llm: makeMockLLMConfig(), worker: { manualWorker: true } });
  t.after(() => { memory.close(); rmSync(dir, { recursive: true, force: true }); });
  let system = "";
  let received: ChatAgentContext | undefined;
  const engine = new CompanionEngine(memory, [{ id: "clownfish", name: "小丑鱼", persona: "可靠的个人助理。" }],
    async () => "完成", { chatStream: async (nextSystem, _user, _cb, _model, _tokens, context) => {
      system = nextSystem; received = context; return "交付完成。";
    } });
  await engine.notifyStream("me", "clownfish", "Run a backend capability\nUser request: 整理材料", { onStatus() {}, onToken() {} }, {
    memoryMode: "off", toolMode: "off", surface: "capability",
    taskAttachments: [{ name: "本轮附件.docx" }],
    projectMaterials: [{ name: "项目A/已选需求.md" }],
    runtimeLimits: { maxRounds: 3, maxToolRounds: 0, maxTotalTokens: 6_000, maxOutputChars: 4_000 },
  });
  assert.match(system, /【统一任务上下文】/);
  assert.match(system, /本轮附件\.docx/);
  assert.match(system, /项目A\/已选需求\.md/);
  assert.equal(received?.mode, "task");
  assert.equal(received?.taskContext?.boundary.tools, "off");
  assert.deepEqual(received?.memoryScopes, []);
});

test("能力运行时只把明确同项目关联的资料传给统一上下文", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-capability-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const received: Array<CapabilityTaskContextSources | undefined> = [];
  let exactSpace = "";
  const runtime = new CapabilityRuntime({
    dataDir: dir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    projectMaterialSources: (ids, spaceId) => spaceId === exactSpace && ids.includes("knowledge-explicit")
      ? [{ name: "已关联项目基线.md" }]
      : [],
    notify: async (_persona, _text, _signal, _limits, _runId, _memory, _surface, sources) => {
      received.push(sources); return { reply: "结果\n\n交付完成。", facts: [] };
    },
  });
  const space = runtime.createSpace({ title: "项目", description: "验收" });
  exactSpace = space.id;
  const task = runtime.createTask({ title: "整理", personaId: "clownfish", capabilityId: "document-draft", instruction: "整理需求", spaceId: space.id, knowledgeIds: ["knowledge-explicit"] });
  await runtime.runTask(task.id, "manual", undefined, { ...budget, taskAttachments: [{ name: "当前上传.txt" }] });
  assert.deepEqual(received[0], {
    taskAttachments: [{ name: "当前上传.txt" }],
    projectMaterials: [{ name: "已关联项目基线.md" }],
  });
});

test("续跑重建执行上下文时保留同一快照，但不从快照反推权限", () => {
  // Even a structurally valid snapshot that claims broader context is descriptive
  // only. The separately persisted enforcement fields remain authoritative.
  const snapshot = assembleUnifiedTaskContext({ taskInput: "继跑", memoryMode: "default", memoryScopes: ["private"], toolMode: "auto", budget });
  const run: Pick<AgentStoredRun, "metadata" | "runId" | "sessionId" | "prompt"> = {
    runId: "resume-context",
    sessionId: "task-1",
    prompt: "继续",
    metadata: {
      userId: "me", personaId: "clownfish", scope: "conv:1on1:me:clownfish", mode: "chat",
      memoryScopes: "[]", toolMode: "off", taskContext: JSON.stringify(snapshot),
    },
  };
  const restored = storedAgentContext(run);
  assert.deepEqual(restored?.taskContext, snapshot);
  assert.deepEqual(restored?.memoryScopes, []);
  assert.equal(restored?.toolMode, "off");
  const forged = storedAgentContext({ ...run, metadata: { ...run.metadata, taskContext: "{broken", memoryScopes: "[]", toolMode: "off" } });
  assert.equal(forged?.taskContext, undefined);
  assert.deepEqual(forged?.memoryScopes, []);
  assert.equal(forged?.toolMode, "off");
});

test("续跑行为上 off 和 read-only 都不会执行写工具", async () => {
  const previousKey = process.env.ZHIPU_API_KEY;
  const previousModel = process.env.ZHIPU_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.ZHIPU_API_KEY = "test-key";
  process.env.ZHIPU_MODEL = "test-model";
  let writes = 0;
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "已安全恢复。" } }] });
  const writeTool: AgentTool = {
    definition: { name: "project_write", description: "write", effect: "write", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    execute: async () => { writes += 1; return { content: "written" }; },
  };
  try {
    for (const toolMode of ["off", "read-only"] as const) {
      const call = { id: `write-${toolMode}`, name: "project_write", arguments: {} };
      const checkpoint = {
        phase: "after_model" as const, round: 1, nextRound: 1,
        messages: [
          { role: "system" as const, content: "system" },
          { role: "user" as const, content: "write" },
          { role: "assistant" as const, content: "", toolCalls: [call] },
        ],
        handoffs: 0, previousToolCallSignature: "project_write", repeatedToolCallCount: 1, pendingToolCalls: [call],
      };
      const run: AgentStoredRun = {
        runId: `resume-${toolMode}`, sessionId: "task", status: "interrupted",
        startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:01.000Z", resumeCount: 0,
        systemPrompt: "system", prompt: "write", metadata: {
          userId: "me", personaId: "clownfish", scope: "task", mode: "task", memoryScopes: "[]", toolMode,
          model: "test-model", maxTokens: "800", maxRounds: "2", maxToolRounds: "1", maxOutputChars: "3000",
        },
        rounds: 1, handoffs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0 }, output: "", messages: checkpoint.messages, events: [],
      };
      const llm = resolveLLM();
      llm.configureAgentTools(() => [writeTool]);
      llm.configureAgentAuthorizer(async () => ({ allowed: true }));
      assert.ok(llm.resumeAgentRun);
      await llm.resumeAgentRun(run, checkpoint);
    }
    assert.equal(writes, 0);
  } finally {
    if (previousKey === undefined) delete process.env.ZHIPU_API_KEY; else process.env.ZHIPU_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ZHIPU_MODEL; else process.env.ZHIPU_MODEL = previousModel;
    globalThis.fetch = previousFetch;
  }
});
