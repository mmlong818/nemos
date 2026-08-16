import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCodexConfig,
  codexDevelopmentEnvironment,
  parseCodexOutput,
  resolveCodexEntrypoint,
  runCodexDevelopment,
} from "../../examples/companion/codex-development.js";

test("Codex 配置使用 Responses API、隔离身份目录且不写入密钥", () => {
  const config = buildCodexConfig({
    provider: "custom",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "mock-model",
    apiKey: "secret-should-not-appear",
  }, "develop", "request", "deep");
  assert.match(config, /model_provider = "clownfish"/);
  assert.match(config, /sandbox_mode = "workspace-write"/);
  assert.match(config, /env_key = "CLOWNFISH_CODEX_API_KEY"/);
  assert.match(config, /wire_api = "responses"/);
  assert.match(config, /model_reasoning_effort = "high"/);
  assert.match(config, /base_url = "http:\/\/127\.0\.0\.1:1234\/v1"/);
  assert.doesNotMatch(config, /secret-should-not-appear/);
});

test("Codex 只读配置明确启用只读沙箱", () => {
  const config = buildCodexConfig({
    provider: "custom",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "mock-model",
    apiKey: "test-key",
  }, "inspect");
  assert.match(config, /sandbox_mode = "read-only"/);
  assert.match(config, /approval_policy = "never"/);
  assert.match(config, /web_search = "disabled"/);
});

test("Codex 完全控制配置使用官方的无沙箱模式", () => {
  const config = buildCodexConfig({
    provider: "custom",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "mock-model",
    apiKey: "test-key",
  }, "develop", "full");
  assert.match(config, /sandbox_mode = "danger-full-access"/);
  assert.match(config, /approval_policy = "never"/);
});

test("Codex 对不支持的 Anthropic 协议给出明确错误", () => {
  assert.throws(() => runCodexDevelopment({
    workspacePath: process.cwd(),
    instruction: "检查项目",
    accessMode: "inspect",
    connection: { provider: "custom", protocol: "anthropic", baseUrl: "http://127.0.0.1:1234", model: "mock", apiKey: "key" },
    agentDir: join(process.cwd(), ".temporary-codex-test"),
  }), /只支持 Responses API 兼容连接/);
});

test("项目安装的 Codex CLI 可以被开发适配层发现", () => {
  assert.ok(resolveCodexEntrypoint()?.endsWith(join("@openai", "codex", "bin", "codex.js")));
  assert.equal(codexDevelopmentEnvironment().available, true);
  assert.match(codexDevelopmentEnvironment().version, /Codex 0\.147\.0/);
});

test("Codex JSONL 事件可还原回复、线程和工具计数", () => {
  const result = parseCodexOutput([
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "检查完成。" } }),
  ].join("\n"));
  assert.equal(result.reply, "检查完成。");
  assert.equal(result.sessionId, "thread-1");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.telemetry, { "thread.started": 1, "item.completed": 2 });
});

test("Codex 已接入开发页面、任务路由和平台就绪检查", () => {
  const companion = join(process.cwd(), "examples", "companion");
  const html = readFileSync(join(companion, "web", "develop.html"), "utf8");
  const settings = readFileSync(join(companion, "web", "settings.html"), "utf8");
  const script = readFileSync(join(companion, "web", "assets", "develop-center.js"), "utf8");
  const server = readFileSync(join(companion, "server.ts"), "utf8");
  const plugins = readFileSync(join(companion, "development-engine-plugins", "codex.ts"), "utf8");
  assert.match(html, /<option value="codex">Codex<\/option>/);
  assert.match(settings, /<option value="codex">Codex<\/option>/);
  assert.match(script, /codex: \{ name: "Codex"/);
  assert.match(server, /developmentEnginePlugins\.run\(developmentEngine/);
  assert.match(server, /developmentEnginePlugins\.readiness\(\)/);
  assert.match(plugins, /id: "codex"[\s\S]*name: "Codex"[\s\S]*packageName: "@openai\/codex"/);
  assert.match(plugins, /runCodexDevelopment/);
});

test("Codex headless 进程可通过 Responses API 兼容连接完成真实只读运行", { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-codex-run-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "# Mock project\n", "utf8");
  let requests = 0;
  const modelServer = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      const response = {
        id: `resp-${requests}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        error: null,
        incomplete_details: null,
        instructions: null,
        max_output_tokens: null,
        model: "mock-model",
        output: [{
          id: "msg-1",
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "已完成 Codex 真实适配检查。", annotations: [], logprobs: [] }],
        }],
        parallel_tool_calls: true,
        previous_response_id: null,
        reasoning: { effort: null, summary: null },
        store: false,
        temperature: 1,
        text: { format: { type: "text" } },
        tool_choice: "auto",
        tools: [],
        top_p: 1,
        truncation: "disabled",
        usage: { input_tokens: 12, input_tokens_details: { cached_tokens: 0 }, output_tokens: 8, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 20 },
        user: null,
        metadata: {},
      };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end([
        `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: response.output[0] })}`,
        `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response })}`,
        "data: [DONE]",
        "",
      ].join("\n\n"));
    });
  });
  await new Promise<void>((accept) => modelServer.listen(0, "127.0.0.1", accept));
  const address = modelServer.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runCodexDevelopment({
      workspacePath: workspace,
      instruction: "检查这个项目并简述结果，不要修改文件。",
      accessMode: "inspect",
      connection: {
        provider: "custom",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "mock-model",
        apiKey: "mock-key",
      },
      agentDir: join(root, "agent"),
    });
    assert.match(result.reply, /Codex 真实适配检查/);
    assert.equal(result.accessMode, "inspect");
    assert.deepEqual(result.changedFiles, []);
    assert.ok(requests >= 1);
  } finally {
    await new Promise<void>((accept, reject) => modelServer.close((error) => error ? reject(error) : accept()));
    rmSync(root, { recursive: true, force: true });
  }
});
