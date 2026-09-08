import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return (server.address() as { port: number }).port;
}

/** Local synthetic provider plus a real Companion process with a fresh data directory. */
export async function startModelHarness() {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-model-check-"));
  const requests: Array<{ url: string; authorization?: string; body: any }> = [];
  let child: ChildProcess | undefined;
  let logs = "";
  let stopHarness: (() => Promise<void>) | undefined;
  const state = { status: 0, delayMs: 0, beforeReply: undefined as (() => Promise<void>) | undefined, replyFor: undefined as ((body: any) => string) | undefined };
  const provider = createServer(async (req, res) => {
    if (req.url === "/__qa/stop" && req.method === "POST") {
      res.end("stopping"); setTimeout(() => { void stopHarness?.(); }, 50); return;
    }
    const status = req.headers.authorization === "Bearer bad-fixture-key" ? 401 : state.status;
    if (status) { res.writeHead(status); res.end("private-provider-body-fixture"); return; }
    res.setHeader("content-type", "application/json");
    if (req.url?.endsWith("/models")) {
      requests.push({ url: req.url, authorization: req.headers.authorization, body: null });
      if (req.url.startsWith("/no-catalog/")) { res.writeHead(404); res.end("No directory"); return; }
      res.end(JSON.stringify({ data: [{ id: "unavailable", created: 40 }, { id: "chat-only", created: 30 }, { id: "ready", created: 20 }, { id: "manual", created: 10 }] })); return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url || "", authorization: req.headers.authorization, body });
    await state.beforeReply?.();
    if (state.delayMs) await new Promise((done) => setTimeout(done, state.delayMs));
    if (body.model === "unavailable" || body.model === "bad-model") { res.writeHead(404); res.end("Model not enabled"); return; }
    if (req.url?.endsWith("/responses")) {
      const last = body.input.at(-1);
      const probe = body.tools?.some((tool: any) => tool.name === "clownfish_connection_probe") && last?.type !== "function_call_output";
      const output = probe ? [
        { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "opaque-fixture" },
        { type: "function_call", id: "fc_fixture", call_id: "check-call", name: "clownfish_connection_probe", arguments: '{"value":7}', status: "completed" },
      ] : [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: last?.type === "function_call_output" ? last.output : "OK" }] }];
      const response = { status: "completed", output, usage: { input_tokens: 10, output_tokens: 5 } };
      if (body.stream) {
        res.setHeader("content-type", "text/event-stream");
        res.end(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`);
      } else res.end(JSON.stringify(response));
      return;
    }
    const probe = body.tools?.some((tool: any) => tool.function?.name === "clownfish_connection_probe") && body.model !== "chat-only";
    const tool = { id: "check-call", type: "function", function: { name: "clownfish_connection_probe", arguments: '{"value":7}' } };
    const text = body.messages.at(-1)?.role === "tool" ? body.messages.at(-1).content : state.replyFor?.(body) ?? "本地模拟回复：已核对输入，并完成当前文字结果。";
    if (body.stream) {
      res.setHeader("content-type", "text/event-stream");
      res.end(`data: ${JSON.stringify({ choices: [{ delta: probe ? { tool_calls: [{ ...tool, index: 0 }] } : { content: text } }] })}\n\ndata: [DONE]\n\n`);
    } else res.end(JSON.stringify({ choices: [{ message: probe ? { content: "", tool_calls: [tool] } : { content: text } }] }));
  });
  const modelPort = await listen(provider);
  const reservation = createServer(); const port = await listen(reservation);
  await new Promise<void>((done) => reservation.close(() => done()));
  const base = `http://127.0.0.1:${port}`;
  const modelBase = `http://127.0.0.1:${modelPort}`;
  const stopApp = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill(); await exited;
  };
  const startApp = async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^COMPANION_|^CLOWNFISH_HOME$|^NEMOS_COMPANION_HOME$|^ZHIPU_API_KEY$|^NODE_USE_ENV_PROXY$/.test(key)));
    child = spawn(process.execPath, ["--import", "tsx", "examples/companion/server.ts"], {
      cwd: resolve(__dirname, "../.."), env: { ...env, CLOWNFISH_HOME: dir, PORT: String(port), ZHIPU_API_KEY: "", NODE_USE_ENV_PROXY: "0" },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
    child.stderr?.on("data", (chunk) => { logs = (logs + chunk).slice(-4000); });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("Fixture app exited: " + logs);
      try { if ((await fetch(base + "/api/runtime")).ok) return; } catch { /* starting */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("Fixture app startup timed out: " + logs);
  };
  stopHarness = async () => {
    await stopApp(); provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try { await startApp(); } catch (error) { await stopHarness(); throw error; }
  return { dir, base, modelBase, requests, state, stop: stopHarness,
    restart: async (whileStopped?: () => void | Promise<void>) => { await stopApp(); await whileStopped?.(); await startApp(); } };
}

/**
 * 保存模型连接必须落一份 `llm-key.dpapi.json`，而 DPAPI 只有 Windows 有
 * （`server.ts` 的 protectSecret 走 powershell.exe）。非 Windows 上保存接口返回 400
 * `spawnSync powershell.exe ENOENT`，不是缺陷而是产品边界：README 写明"Windows 下密钥
 * 使用当前用户的 DPAPI 加密"。
 *
 * 因此这几个整合测试按平台跳过，与 three-dimensional-verifier 缺 Blender 时同一处理。
 * **不要**为了让 Linux 变绿而给非 Windows 造一套更弱的落盘加密——那是在发明没有用户
 * 拥有的产品行为，而且是更不安全的那一种。真要支持，见
 * docs/model-key-storage-non-windows-2026-09-08.md。
 */
export const DPAPI_ONLY = process.platform === "win32"
  ? false
  : "需要 Windows DPAPI 保存模型密钥（非 Windows 上保存接口按设计返回 400）";

if (process.argv.includes("--serve-model-qa")) {
  startModelHarness().then((harness) => console.log(JSON.stringify({ base: harness.base, modelBase: harness.modelBase, dataDir: harness.dir })))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
