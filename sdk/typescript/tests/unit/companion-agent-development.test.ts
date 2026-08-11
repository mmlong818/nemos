// companion-agent-development.test.ts — v0.8 角色自主发起开发子任务
//
// 这个工具的两条边界必须同时成立：
// 1. 工作区只能从用户已授权的清单里选，模型不能自己填路径；
// 2. develop 模式的产出仍是提案，要用户确认才写进项目。
// 任何一条破了，都等于把「动哪个目录的代码」的决定权交给了模型。

import assert from "node:assert/strict";
import test from "node:test";

import type { Nemos } from "../../src/index.js";
import type { CapabilityRuntime, CapabilityTask, CapabilityTaskWorkspace } from "../../examples/companion/capabilities.js";
import { createCompanionAgentToolProvider } from "../../examples/companion/companion-agent-tools.js";
import type { ChatAgentContext } from "../../examples/companion/engine.js";

const context: ChatAgentContext = {
  runId: "test-context",
  sessionId: "conv:user-a:clownfish",
  userId: "user-a",
  personaId: "clownfish",
  instruction: "",
  scope: "conv:user-a:clownfish",
  memoryScopes: ["conv:user-a:clownfish"],
  mode: "chat",
};

const AUTHORIZED = "C:/projects/clownfish";

function runtime(workspaces: CapabilityTaskWorkspace[]): {
  capabilities: () => CapabilityRuntime;
  created: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  const stub = {
    listDevelopmentWorkspaces: () => workspaces.map((item) => ({ ...item })),
    createTask: (input: Record<string, unknown>) => {
      created.push(input);
      return { id: "task-1", title: String(input.title) } as CapabilityTask;
    },
  } as unknown as CapabilityRuntime;
  return { capabilities: () => stub, created };
}

const deps = (workspaces: CapabilityTaskWorkspace[]) => {
  const { capabilities, created } = runtime(workspaces);
  return {
    provider: createCompanionAgentToolProvider({ memory: () => ({} as Nemos), capabilities }),
    created,
  };
};

const toolFor = async (
  provider: ReturnType<typeof createCompanionAgentToolProvider>,
  instruction: string,
) => (await provider(instruction, context)).find((item) => item.definition.name === "development_task_create");

const call = { runId: "test", sessionId: "test", signal: new AbortController().signal };

test("没有已授权工作区时，开发工具根本不出现", async () => {
  const { provider } = deps([]);
  assert.equal(await toolFor(provider, "帮我改一下这个项目的代码"), undefined);
});

test("有已授权工作区时才挂出开发工具，且只在相关请求上", async () => {
  const { provider } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  assert.ok(await toolFor(provider, "帮我修复构建失败的问题"));
  // 无关请求不该把这个写工具带出来。
  assert.equal(await toolFor(provider, "今天天气怎么样"), undefined);
});

test("schema 把可选工作区限定成已授权的那几个", async () => {
  const { provider } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  const tool = await toolFor(provider, "帮我重构这个代码库");
  assert.ok(tool);
  const schema = tool.definition.inputSchema as {
    properties: { workspacePath: { enum?: string[] } };
  };
  assert.deepEqual(schema.properties.workspacePath.enum, [AUTHORIZED]);
});

test("模型给出清单外的路径时直接拒绝，不创建任务", async () => {
  const { provider, created } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  const tool = await toolFor(provider, "帮我改代码");
  assert.ok(tool);
  const result = await tool.execute(
    {
      title: "偷偷改别的项目",
      instruction: "改一下",
      workspacePath: "C:/Users/someone/.ssh",
      accessMode: "develop",
    },
    call,
  );
  assert.equal(result.isError, true);
  assert.match(result.content, /工作区未被授权/);
  assert.equal(created.length, 0, "被拒绝的请求不该留下任何任务");
});

test("授权路径下正常建任务，并说明修改仍需用户确认", async () => {
  const { provider, created } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  const tool = await toolFor(provider, "帮我改代码");
  assert.ok(tool);
  const result = await tool.execute(
    { title: "修构建", instruction: "让 build 通过", workspacePath: AUTHORIZED, accessMode: "develop" },
    call,
  );
  assert.equal(result.isError, undefined);
  assert.match(result.content, /需用户在能力页确认后才写入项目/);
  assert.equal(created.length, 1);
  assert.equal(created[0].capabilityId, "project-development");
  assert.deepEqual(created[0].workspace, { path: AUTHORIZED, accessMode: "develop" });
  // 手动触发：角色建任务不等于立刻动代码。
  assert.deepEqual(created[0].schedule, { mode: "manual" });
});

test("accessMode 只认 develop，其余一律降级为只读", async () => {
  const { provider, created } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  const tool = await toolFor(provider, "帮我做项目检查");
  assert.ok(tool);
  await tool.execute(
    { title: "看看", instruction: "读一下", workspacePath: AUTHORIZED, accessMode: "write-everything" },
    call,
  );
  assert.deepEqual(created[0].workspace, { path: AUTHORIZED, accessMode: "inspect" });
});

test("这个工具只给主角色，其它角色拿不到", async () => {
  const { provider } = deps([{ path: AUTHORIZED, accessMode: "develop" }]);
  const tools = await provider("帮我改代码", { ...context, personaId: "researcher" });
  assert.equal(tools.some((item) => item.definition.name === "development_task_create"), false);
});
