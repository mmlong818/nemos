import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

const root = resolve(__dirname, "../..");

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function until(check: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Timed out: " + description);
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

test("完整服务：无页面自动交付、状态接口只读、保存模型及重启后会话连续", { timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-reliability-http-"));
  let child: ChildProcess | undefined;
  let logs = "";
  const modelRequests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const model = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "regression-model", created: 1 }] }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    modelRequests.push(body);
    const last = body.messages.at(-1);
    const probe = body.tools?.some((tool: any) => tool.function?.name === "clownfish_connection_probe") && last?.role !== "tool";
    const finish = body.tools?.some((tool: any) => tool.function?.name === "finish_turn");
    const reply = body.messages.at(-1)?.role === "tool" ? body.messages.at(-1).content : "本地模拟模型回复";
    const tool = { id: "check-call", type: "function", function: { name: "clownfish_connection_probe", arguments: '{"value":7}' } };
    const finishCall = { id: "finish-call", type: "function", function: { name: "finish_turn", arguments: '{"state":"completed"}' } };
    if (body.stream) {
      res.setHeader("content-type", "text/event-stream");
      const delta = probe ? { tool_calls: [{ ...tool, index: 0 }] } : finish ? { content: reply, tool_calls: [{ ...finishCall, index: 0 }] } : { content: reply };
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    } else {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: probe ? { role: "assistant", content: "", tool_calls: [tool] } : finish ? { role: "assistant", content: reply, tool_calls: [finishCall] } : { role: "assistant", content: reply }, finish_reason: "stop" }] }));
    }
  });
  try {
    const modelPort = await listen(model);
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise<void>((done) => reservation.close(() => done()));
    const base = `http://127.0.0.1:${port}`;
    let task: { id: string };
    const persistedJobs = () => {
      try { return (JSON.parse(readFileSync(join(dir, "agent-jobs.json"), "utf8")).jobs as Array<{ id: string; status: string; payload: { taskId?: string }; result?: unknown }>).filter((job) => job.payload.taskId === task.id); }
      catch { return []; }
    };
    const start = () => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^COMPANION_|^CLOWNFISH_HOME$|^NEMOS_COMPANION_HOME$|^ZHIPU_API_KEY$|^NODE_USE_ENV_PROXY$/.test(key)));
      child = spawn(process.execPath, ["--import", "tsx", "examples/companion/server.ts"], { cwd: root,
        env: { ...env, CLOWNFISH_HOME: dir, PORT: String(port), ZHIPU_API_KEY: "", NODE_USE_ENV_PROXY: "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (chunk) => { logs = (logs + chunk).slice(-6000); });
      child.stderr?.on("data", (chunk) => { logs = (logs + chunk).slice(-6000); });
    };
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(data));
      return data;
    };
    start();
    await until(async () => { try { return (await fetch(base + "/api/runtime")).ok; } catch { return false; } }, "service startup");
    const connection = { provider: "custom", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: "regression-model" };
    await request("/api/llm-config", connection);
    const checked = await request("/api/llm-model/check", { model: "regression-model" });
    assert.equal(checked.checked.chat, "passed");
    // Create the due task only after the verified connection is durable. This
    // preserves the no-browser scheduler assertion without letting first boot
    // consume the task under an intentionally offline default.
    await stop(child);
    const runtime = new CapabilityRuntime({ dataDir: dir, personas: () => [{ id: "clownfish", name: "小丑鱼" }], notify: async () => ({ reply: "未使用的测试入口", facts: [] }) });
    const ability = runtime.createGeneratedAbility({ personaId: "clownfish", name: "自动交付回归", goal: "输出一段简短文字", defaultFormat: "md" });
    task = runtime.createTask({ title: "无页面自动任务", personaId: "clownfish", capabilityId: ability.id, instruction: "输出一段简短文字", format: "md", enabled: true,
      schedule: { mode: "daily", time: "00:00", timezone: "Asia/Shanghai", days: [1, 2, 3, 4, 5, 6, 7] } });
    logs = "";
    start();
    await until(async () => { try { return (await fetch(base + "/api/runtime")).ok; } catch { return false; } }, "verified service restart");
    // No HTTP requests at all until the server itself has enqueued and delivered.
    await until(() => {
      if (child?.exitCode !== null) throw new Error("Service exited: " + logs);
      const jobs = persistedJobs();
      const failed = jobs.find((job) => job.status === "failed");
      if (failed) throw new Error("Background task failed: " + JSON.stringify(failed));
      return jobs.some((job) => job.status === "succeeded");
    }, "background task completes without a browser; " + logs);
    assert.equal(persistedJobs().length, 1);
    assert.ok(persistedJobs()[0].result);
    const originalJobId = persistedJobs()[0].id;
    for (let i = 0; i < 3; i++) {
      const status = await request("/api/capabilities/due");
      assert.equal(status.scheduler.running, true);
      assert.deepEqual(status.scheduler.failedTasks, []);
    }
    assert.equal(persistedJobs().length, 1);
    const connections = await request("/api/platform/readiness");
    assert.equal(connections.connectors.find((item: any) => item.id === "browser").state, "not-installed");
    const send = (text: string, sessionId: string) => request("/api/chat", { text, sessionId, target: { kind: "persona", id: "clownfish" }, workMode: "task", toolMode: "off" });
    await send("CONTINUITY_HTTP_A_4731", "session-a");
    await send("CONTINUITY_HTTP_B_8822", "session-b");
    await request("/api/llm-config", connection); // Rebuild without restarting server.
    await send("CONTINUE_AFTER_MODEL_SAVE", "session-a");
    const promptAfterSave = JSON.stringify(modelRequests.at(-1)?.messages);
    assert.match(promptAfterSave, /CONTINUITY_HTTP_A_4731/);
    assert.doesNotMatch(promptAfterSave, /CONTINUITY_HTTP_B_8822/);
    await stop(child);
    logs = "";
    start();
    await until(async () => { try { return (await fetch(base + "/api/runtime")).ok; } catch { return false; } }, "service restart");
    await send("CONTINUE_AFTER_RESTART", "session-a");
    assert.match(JSON.stringify(modelRequests.at(-1)?.messages), /CONTINUITY_HTTP_A_4731/);
    assert.doesNotMatch(JSON.stringify(modelRequests.at(-1)?.messages), /CONTINUITY_HTTP_B_8822/);
    assert.equal(persistedJobs().length, 1);
    assert.equal(persistedJobs()[0].id, originalJobId);
  } finally {
    await stop(child);
    model.closeAllConnections();
    await new Promise<void>((done) => model.close(() => done()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
