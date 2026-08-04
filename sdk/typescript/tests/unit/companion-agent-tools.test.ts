import assert from "node:assert/strict";
import test from "node:test";

import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";

const context: ChatAgentContext = {
  runId: "test-context",
  sessionId: "conv:user-a:persona-a",
  userId: "user-a",
  personaId: "persona-a",
  instruction: "",
  scope: "conv:user-a:persona-a",
  memoryScopes: ["conv:user-a:persona-a", "group:shared"],
  mode: "chat",
};

test("product Agent tools are loaded only for a relevant request", async () => {
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => ({} as CapabilityRuntime),
  });

  assert.deepEqual(await provider("你好", context), []);
  assert.deepEqual(
    (await provider("你还记得我之前说过什么吗", context)).map((tool) => tool.definition.name),
    ["memory_recall"],
  );
  assert.deepEqual(
    (await provider("看看我的任务和最近产物", context)).map((tool) => tool.definition.name),
    ["capability_task_list", "capability_artifact_list"],
  );
});

test("memory tool preserves the Engine-provided user and persona scope boundary", async () => {
  let requestedUser = "";
  let requestedScopes: string[] = [];
  const memory = {
    forUser(userId: string) {
      requestedUser = userId;
      return {
        async getRelevantContext(_query: string, options: { scopes?: string[] }) {
          requestedScopes = options.scopes ?? [];
          return "- 用户喜欢无糖咖啡";
        },
      };
    },
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => memory as unknown as Nemos,
    capabilities: () => ({} as CapabilityRuntime),
  });
  const tool = (await provider("记得我喜欢喝什么吗", context))[0];
  assert.ok(tool);

  const result = await tool.execute(
    { query: "饮品偏好" },
    { runId: "test", sessionId: "test", signal: new AbortController().signal },
  );

  assert.equal(requestedUser, "user-a");
  assert.deepEqual(requestedScopes, context.memoryScopes);
  assert.match(result.content, /无糖咖啡/);
});

test("task and artifact tools never return another persona's records", async () => {
  const capabilities = {
    snapshot: () => ({
      tasks: [
        { id: "task-a", title: "我的任务", personaId: "persona-a", enabled: true, schedule: { mode: "manual" }, updatedAt: "2026-07-30" },
        { id: "task-b", title: "其他人的任务", personaId: "persona-b", enabled: true, schedule: { mode: "manual" }, updatedAt: "2026-07-30" },
      ],
      artifacts: [
        { id: "artifact-a", title: "我的报告", personaId: "persona-a", format: "md", createdAt: "2026-07-30", summary: "可见" },
        { id: "artifact-b", title: "其他人的报告", personaId: "persona-b", format: "md", createdAt: "2026-07-30", summary: "不可见" },
      ],
    }),
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => capabilities as unknown as CapabilityRuntime,
  });
  const tools = await provider("查看任务和最近产物", context);
  const signal = new AbortController().signal;
  const taskResult = await tools[0]!.execute({}, { runId: "test", sessionId: "test", signal });
  const artifactResult = await tools[1]!.execute({}, { runId: "test", sessionId: "test", signal });

  assert.match(taskResult.content, /我的任务/);
  assert.doesNotMatch(taskResult.content, /其他人的任务/);
  assert.match(artifactResult.content, /我的报告/);
  assert.doesNotMatch(artifactResult.content, /其他人的报告/);
});

test("only zhiwei receives the approved write tool for saving recurring work", async () => {
  const created: Array<Record<string, unknown>> = [];
  const capabilities = {
    snapshot: () => ({
      abilities: [{ id: "research-brief", name: "资料收集简报" }],
      tasks: [],
      artifacts: [],
    }),
    createGeneratedAbility: (input: Record<string, unknown>) => {
      created.push({ kind: "ability", ...input });
      return { id: "generated-1", name: input.name, defaultFormat: input.defaultFormat };
    },
    createTask: (input: Record<string, unknown>) => {
      created.push({ kind: "task", ...input });
      return { id: "task-1", title: input.title, schedule: input.schedule };
    },
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => capabilities as unknown as CapabilityRuntime,
  });
  const zhiweiContext = { ...context, personaId: "zhiwei" };
  const zhiweiTools = await provider("把每天的 AI 新闻收集保存为常规任务", zhiweiContext);
  const writeTool = zhiweiTools.find((tool) => tool.definition.name === "capability_task_create");

  assert.equal(writeTool?.definition.effect, "write");
  assert.equal(
    (await provider("把每天的 AI 新闻收集保存为常规任务", context))
      .some((tool) => tool.definition.name === "capability_task_create"),
    false,
  );

  const result = await writeTool!.execute({
    title: "每日 AI 新闻",
    instruction: "收集过去 24 小时的重要 AI 新闻并输出 Markdown。",
    capabilityId: "",
    createRecurringTask: true,
    format: "md",
    scheduleMode: "daily",
    time: "09:30",
  }, {
    runId: "approved-write",
    sessionId: "approved-write",
    signal: new AbortController().signal,
  });

  assert.equal(result.isError, undefined);
  assert.equal(created.length, 2);
  assert.equal(created[0]?.personaId, "zhiwei");
  assert.deepEqual(created[1]?.schedule, {
    mode: "daily",
    time: "09:30",
    timezone: "Asia/Shanghai",
    days: [1, 2, 3, 4, 5, 6, 7],
  });
});
test("only Zhiwei can install a Skill and the write happens after tool execution", async () => {
  const installed: Array<Record<string, unknown>> = [];
  const fetched: string[] = [];
  const capabilities = {
    snapshot: () => ({
      abilities: [],
      tasks: [],
      artifacts: [],
      skillAudit: {
        items: [{
          abilityId: "skill-1",
          skillFile: "C:\\data\\skills\\zhiwei\\news\\SKILL.md",
        }],
      },
    }),
    installSkill: (input: Record<string, unknown>) => {
      installed.push(input);
      return {
        id: "skill-1",
        name: "AI News",
        description: "Collect AI news",
        defaultFormat: "md",
      };
    },
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => capabilities as unknown as CapabilityRuntime,
    fetchSkillSource: async (url, signal) => {
      assert.equal(signal.aborted, false);
      fetched.push(url);
      return "# AI News\n\nCollect current AI news.";
    },
  });
  const zhiweiContext = { ...context, personaId: "zhiwei" };
  const tools = await provider("帮我安装这个 skill：https://example.test/SKILL.md", zhiweiContext);
  const installTool = tools.find((tool) => tool.definition.name === "skill_install");

  assert.equal(installTool?.definition.effect, "write");
  assert.equal(
    (await provider("帮我安装这个 skill：https://example.test/SKILL.md", context))
      .some((tool) => tool.definition.name === "skill_install"),
    false,
  );

  const result = await installTool!.execute({
    sourceUrl: "https://example.test/SKILL.md",
    format: "md",
  }, {
    runId: "approved-skill-install",
    sessionId: "approved-skill-install",
    signal: new AbortController().signal,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(fetched, ["https://example.test/SKILL.md"]);
  assert.equal(installed.length, 1);
  assert.equal(installed[0]?.personaId, "zhiwei");
  assert.match(String(installed[0]?.sourceText), /Collect current AI news/);
  assert.match(result.content, /SKILL\.md/);
});

test("Zhiwei can delegate bounded expert work and always adds a final review task", async () => {
  const queued: Array<{ input: unknown; idempotencyKey: string }> = [];
  const capabilities = {
    snapshot: () => ({
      abilities: [{ id: "research-brief", name: "资料收集简报" }],
      tasks: [],
      artifacts: [],
    }),
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => capabilities as unknown as CapabilityRuntime,
    listPersonas: () => [
      { id: "zhiwei", name: "知微" },
      { id: "musk", name: "马斯克" },
      { id: "munger", name: "芒格" },
    ],
    enqueueOrchestration: (input, idempotencyKey) => {
      queued.push({ input, idempotencyKey });
      return { id: "job-1", status: "queued" };
    },
  });
  const zhiweiContext = { ...context, personaId: "zhiwei" };
  const tools = await provider("让马斯克和芒格分别分析并交叉复核这个方案", zhiweiContext);
  const delegationTool = tools.find((tool) => tool.definition.name === "agent_delegation_create");

  assert.equal(delegationTool?.definition.effect, "write");
  assert.equal(
    (await provider("让马斯克和芒格分别分析并交叉复核这个方案", context))
      .some((tool) => tool.definition.name === "agent_delegation_create"),
    false,
  );

  const result = await delegationTool!.execute({
    objective: "判断新产品方案是否值得推进",
    assignments: [
      {
        personaId: "musk",
        title: "第一性原理分析",
        instruction: "从技术可行性和规模化角度分析。",
        format: "md",
      },
      {
        personaId: "munger",
        title: "风险与反向思考",
        instruction: "从机会成本和失败模式角度分析。",
        format: "md",
      },
    ],
  }, {
    runId: "delegation-session",
    sessionId: "delegation-session",
    signal: new AbortController().signal,
  });

  assert.equal(result.isError, undefined);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.idempotencyKey, "delegation:delegation-session");
  const plan = queued[0]?.input as {
    tasks: Array<{
      id: string;
      dependsOn?: string[];
      metadata: Record<string, string>;
      budget: { maxRounds: number; maxToolRounds: number; maxTotalTokens: number; maxOutputChars: number };
    }>;
  };
  assert.equal(plan.tasks.length, 3);
  assert.deepEqual(plan.tasks[2]?.dependsOn, ["delegate-1", "delegate-2"]);
  assert.equal(plan.tasks[2]?.metadata.personaId, "zhiwei");
  assert.equal(plan.tasks[2]?.metadata.role, "reviewer");
  assert.deepEqual(plan.tasks[0]?.budget, {
    maxRounds: 4,
    maxToolRounds: 3,
    maxTotalTokens: 12_000,
    maxOutputChars: 20_000,
  });
  assert.match(result.content, /job-1/);
});

test("delegation refuses plans that do not use distinct expert personas", async () => {
  let enqueued = false;
  const capabilities = {
    snapshot: () => ({
      abilities: [{ id: "research-brief", name: "资料收集简报" }],
      tasks: [],
      artifacts: [],
    }),
  };
  const provider = createCompanionAgentToolProvider({
    memory: () => ({} as Nemos),
    capabilities: () => capabilities as unknown as CapabilityRuntime,
    listPersonas: () => [
      { id: "zhiwei", name: "知微" },
      { id: "musk", name: "马斯克" },
    ],
    enqueueOrchestration: () => {
      enqueued = true;
      return { id: "job-1", status: "queued" };
    },
  });
  const tool = (await provider(
    "请多位专家分工分析",
    { ...context, personaId: "zhiwei" },
  )).find((item) => item.definition.name === "agent_delegation_create");

  const result = await tool!.execute({
    objective: "分析方案",
    assignments: [
      { personaId: "musk", title: "角度一", instruction: "分析技术", format: "md" },
      { personaId: "musk", title: "角度二", instruction: "分析商业", format: "md" },
    ],
  }, {
    runId: "duplicate-persona",
    sessionId: "duplicate-persona",
    signal: new AbortController().signal,
  });

  assert.equal(result.isError, true);
  assert.match(result.content, /distinct expert personas/);
  assert.equal(enqueued, false);
});
