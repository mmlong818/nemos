import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentRuntime,
  FileAgentApprovalStore,
  type AgentModel,
  type AgentTool,
  type AgentToolAuthorizationInput,
} from "../../src/agent/index.js";

const fakeApiKey = ["sk", "1234567890abcdef"].join("-");

function writeInput(signal = new AbortController().signal, runId = "approval-run"): AgentToolAuthorizationInput {
  return {
    runId,
    sessionId: "approval-session",
    call: { id: "write-1", name: "save_file", arguments: { path: "report.md", apiKey: fakeApiKey } },
    tool: {
      name: "save_file",
      description: "Save a report",
      inputSchema: { type: "object" },
      effect: "write",
    },
    metadata: { userId: "user-a", personaId: "clownfish" },
    signal,
  };
}

async function waitForPending(store: FileAgentApprovalStore): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const item = store.list({ status: "pending" })[0];
    if (item) return item.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("approval was not created");
}

test("pauses a write tool until its durable approval is allowed once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-"));
  try {
    const file = join(dir, "approvals.json");
    const events: string[] = [];
    const store = new FileAgentApprovalStore(file, {
      onChange: (event) => events.push(event.action),
    });
    let modelCalls = 0;
    let executions = 0;
    const model: AgentModel = {
      complete: async () => ++modelCalls === 1
        ? { text: "", toolCalls: [{ id: "write-1", name: "save_file", arguments: { path: "report.md", apiKey: fakeApiKey } }] }
        : { text: "saved" },
    };
    const tool: AgentTool = {
      definition: {
        name: "save_file",
        description: "Save a report",
        inputSchema: { type: "object" },
        effect: "write",
      },
      execute: async () => {
        executions++;
        return { content: "ok" };
      },
    };
    const run = new AgentRuntime(model, [tool], {
      authorizeTool: (input) => store.authorize(input),
    }).run({
      runId: "approval-run",
      sessionId: "approval-session",
      systemPrompt: "system",
      prompt: "save it",
      metadata: { userId: "user-a", personaId: "clownfish" },
    });

    const approvalId = await waitForPending(store);
    assert.equal(executions, 0);
    assert.equal(store.get(approvalId)?.active, true);
    store.decide(approvalId, true);

    const result = await run;
    assert.equal(result.output, "saved");
    assert.equal(executions, 1);
    assert.equal(store.get(approvalId)?.status, "consumed");
    assert.deepEqual(events, ["requested", "approved", "consumed"]);
    assert.equal(readFileSync(file, "utf8").includes(fakeApiKey), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persists an approved decision for the matching interrupted call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-resume-"));
  const controller = new AbortController();
  try {
    const file = join(dir, "approvals.json");
    const first = new FileAgentApprovalStore(file);
    void first.authorize(writeInput(controller.signal));
    const approvalId = await waitForPending(first);

    const afterRestart = new FileAgentApprovalStore(file);
    afterRestart.decide(approvalId, true);
    const resumed = new FileAgentApprovalStore(file);
    const decision = await resumed.authorize(writeInput());

    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalId, approvalId);
    assert.equal(resumed.get(approvalId)?.status, "consumed");
  } finally {
    controller.abort();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps approval decisions isolated between runs in the same session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-agent-approval-run-isolation-"));
  const first = new AbortController();
  const second = new AbortController();
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    void store.authorize(writeInput(first.signal, "run-one"));
    void store.authorize(writeInput(second.signal, "run-two"));

    for (let attempt = 0; attempt < 50 && store.list({ status: "pending" }).length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const pending = store.list({ status: "pending" });
    assert.equal(pending.length, 2);
    assert.deepEqual(new Set(pending.map((item) => item.sessionId)), new Set(["approval-session"]));
    assert.deepEqual(new Set(pending.map((item) => item.runId)), new Set(["run-one", "run-two"]));
    assert.equal(new Set(pending.map((item) => item.fingerprint)).size, 2);
  } finally {
    first.abort();
    second.abort();
    rmSync(dir, { recursive: true, force: true });
  }
});

// —— 会话级批准（approve_for_session）——
// 原有两档粒度：指纹去重（含 runId 与具体参数，只覆盖同一次调用）和跨会话永久准则。
// 中间缺"本会话内同类操作都放行"这一档，这一组盯它。
//
// 这里一律用 settledWithin 判定，不直接 await：功能缺失时 authorize 会一直等用户决定，
// 直接 await 会把整个套件挂死到审批超时，而不是快速失败。

function sessionInput(args: Record<string, unknown>, runId: string, sessionId = "approval-session"): AgentToolAuthorizationInput {
  return {
    runId,
    sessionId,
    call: { id: "write-" + runId, name: "save_file", arguments: args },
    tool: { name: "save_file", description: "Save a report", inputSchema: { type: "object" }, effect: "write" },
    signal: new AbortController().signal,
  };
}

async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | "pending"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"pending">((resolve) => { timer = setTimeout(() => resolve("pending"), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("会话级批准后，同一会话内同名工具换参数不再询问", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-session-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1"));
    const id = await waitForPending(store);
    store.decide(id, true, "本次会话都允许", "session");
    assert.equal((await first).allowed, true);

    // 换参数、换 runId——指纹完全不同，靠会话授权放行。
    const second = await settledWithin(store.authorize(sessionInput({ path: "b.md" }, "run-2")), 1_000);
    assert.notEqual(second, "pending", "会话授权应立刻放行，不再产生审批卡");
    assert.equal(second !== "pending" && second.allowed, true);
    assert.match(String(second !== "pending" && second.reason), /session/);
    assert.equal(store.list({ status: "pending" }).length, 0);

    const grants = store.listSessionGrants("approval-session");
    assert.equal(grants.length, 1);
    assert.equal(grants[0]?.tool, "save_file");
    assert.equal(grants[0]?.approvalId, id, "授权要能溯源到那次批准");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("会话级批准不泄漏到其他会话", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-session-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1", "session-A"));
    const id = await waitForPending(store);
    store.decide(id, true, undefined, "session");
    await first;

    const other = store.authorize(sessionInput({ path: "a.md" }, "run-9", "session-B"));
    assert.equal(await settledWithin(other, 500), "pending", "另一个会话必须重新询问");
    assert.deepEqual(store.listSessionGrants("session-B"), []);
    const pending = store.list({ status: "pending" })[0];
    assert.ok(pending && pending.id !== id);
    store.decide(pending.id, false, "拒绝");
    assert.equal((await other).allowed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("会话级批准跨重启仍生效，且文件格式保持 version 1 兼容", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-session-"));
  try {
    const file = join(dir, "approvals.json");
    const store = new FileAgentApprovalStore(file);
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1"));
    const id = await waitForPending(store);
    store.decide(id, true, undefined, "session");
    await first;

    const saved = JSON.parse(readFileSync(file, "utf8")) as { version: number; sessionGrants?: unknown[] };
    assert.equal(saved.version, 1, "不升 version：旧版本读到未知字段会忽略，而不是整份拒读");
    assert.equal(saved.sessionGrants?.length, 1);

    const reopened = new FileAgentApprovalStore(file);
    const afterRestart = await settledWithin(reopened.authorize(sessionInput({ path: "c.md" }, "run-3")), 1_000);
    assert.notEqual(afterRestart, "pending", "重启后不该重新询问");
    assert.equal(afterRestart !== "pending" && afterRestart.allowed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("默认仍是只批准一次：不传 scope 时同会话换参数照旧要审批", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-session-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1"));
    const id = await waitForPending(store);
    store.decide(id, true, "只这一次");
    await first;
    assert.deepEqual(store.listSessionGrants(), []);

    const again = store.authorize(sessionInput({ path: "b.md" }, "run-2"));
    assert.equal(await settledWithin(again, 500), "pending", "默认档不该放行后续调用");
    const pending = store.list({ status: "pending" })[0];
    assert.ok(pending && pending.id !== id);
    store.decide(pending.id, false, "拒绝");
    assert.equal((await again).allowed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

// —— 会话级授权的有效期与撤销 ——
// 第一版实现里这两样都没有：唯一的移除路径是 500 条数量淘汰，而这个代码库
// 根本没有"会话结束"这个信号（sessionId 是长期对话标识）。那等于一个看不见、
// 收不回的永久放行，在治理上比 work-guidelines 的 allow-automatically 还差。

test("会话级授权会到期，到期后重新询问", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-ttl-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"), { sessionGrantTtlMs: 60_000 });
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1"));
    const id = await waitForPending(store);
    store.decide(id, true, undefined, "session");
    await first;

    const grant = store.listSessionGrants()[0];
    assert.ok(grant?.expiresAt, "授权必须带到期时间，否则就是永久放行");
    assert.ok(Date.parse(grant.expiresAt) > Date.now());

    // 把到期时间改到过去，模拟时间流逝。
    const file = join(dir, "approvals.json");
    const saved = JSON.parse(readFileSync(file, "utf8")) as { sessionGrants: Array<{ expiresAt: string }> };
    saved.sessionGrants[0]!.expiresAt = new Date(Date.now() - 1_000).toISOString();
    writeFileSync(file, JSON.stringify(saved));

    const reopened = new FileAgentApprovalStore(file, { sessionGrantTtlMs: 60_000 });
    assert.deepEqual(reopened.listSessionGrants(), [], "过期授权不该被载入");
    const again = reopened.authorize(sessionInput({ path: "b.md" }, "run-2"));
    assert.equal(await settledWithin(again, 500), "pending", "过期后必须重新询问");
    const pending = reopened.list({ status: "pending" })[0];
    assert.ok(pending);
    reopened.decide(pending.id, false, "拒绝");
    await again;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("会话级授权可以撤销，撤销后恢复逐次询问", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-revoke-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    const first = store.authorize(sessionInput({ path: "a.md" }, "run-1"));
    const id = await waitForPending(store);
    store.decide(id, true, undefined, "session");
    await first;
    assert.equal(store.listSessionGrants().length, 1);

    assert.equal(store.revokeSessionGrant("approval-session", "nope"), false, "撤不存在的返回 false");
    assert.equal(store.revokeSessionGrant("approval-session", "save_file"), true);
    assert.deepEqual(store.listSessionGrants(), []);

    const again = store.authorize(sessionInput({ path: "b.md" }, "run-2"));
    assert.equal(await settledWithin(again, 500), "pending", "撤销后必须重新询问");
    const pending = store.list({ status: "pending" })[0];
    assert.ok(pending);
    store.decide(pending.id, false, "拒绝");
    await again;

    // 撤销要落盘，不能只在内存里。
    assert.deepEqual(new FileAgentApprovalStore(join(dir, "approvals.json")).listSessionGrants(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("可以一次撤销某个会话的全部授权", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-approval-revoke-all-"));
  try {
    const store = new FileAgentApprovalStore(join(dir, "approvals.json"));
    for (const [runId, tool] of [["run-1", "save_file"], ["run-2", "send_mail"]] as const) {
      const input = { ...sessionInput({ path: "a.md" }, runId), call: { id: runId, name: tool, arguments: {} } };
      input.tool = { ...input.tool, name: tool };
      const pendingRun = store.authorize(input);
      const id = await waitForPending(store);
      store.decide(id, true, undefined, "session");
      await pendingRun;
    }
    assert.equal(store.listSessionGrants("approval-session").length, 2);
    assert.equal(store.revokeSessionGrants("approval-session"), 2);
    assert.deepEqual(store.listSessionGrants(), []);
    assert.equal(store.revokeSessionGrants("approval-session"), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
