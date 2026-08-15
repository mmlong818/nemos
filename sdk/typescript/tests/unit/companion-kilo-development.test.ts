import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildKiloConfig,
  kiloDevelopmentEnvironment,
  parseKiloOutput,
  resolveKiloEntrypoint,
  runKiloDevelopment,
} from "../../examples/companion/kilo-development.js";

test("Kilo Code 配置复用当前模型连接但不写入密钥", () => {
  const config = buildKiloConfig({
    provider: "custom",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "mock-model",
    apiKey: "secret-should-not-appear",
  }, "develop");
  const parsed = JSON.parse(config);
  assert.equal(parsed.model, "openai-compatible/mock-model");
  assert.equal(parsed.provider["openai-compatible"].options.baseURL, "http://127.0.0.1:1234/v1");
  assert.equal(parsed.provider["openai-compatible"].options.apiKey, "{env:CLOWNFISH_KILO_API_KEY}");
  assert.equal(parsed.permission.external_directory, "deny");
  assert.doesNotMatch(config, /secret-should-not-appear/);
});

test("Kilo Code 只读配置在执行层禁止写文件和命令", () => {
  const config = JSON.parse(buildKiloConfig({
    provider: "custom",
    protocol: "anthropic",
    baseUrl: "http://127.0.0.1:1234",
    model: "mock-model",
    apiKey: "test-key",
  }, "inspect"));
  assert.equal(config.model, "anthropic/mock-model");
  assert.equal(config.permission.edit, "deny");
  assert.equal(config.permission.write, "deny");
  assert.equal(config.permission.apply_patch, "deny");
  assert.equal(config.permission.bash, "deny");
  assert.equal(config.permission.external_directory, "deny");
});

test("项目安装的 Kilo Code CLI 可以被开发适配层发现", () => {
  assert.ok(resolveKiloEntrypoint()?.endsWith(join("@kilocode", "cli", "bin", "kilo")));
  assert.equal(kiloDevelopmentEnvironment().available, true);
  assert.match(kiloDevelopmentEnvironment().version, /Kilo Code 7\.4\.22/);
});

test("Kilo Code JSON 事件可还原回复、会话和工具计数", () => {
  const result = parseKiloOutput([
    JSON.stringify({ type: "tool_use", sessionID: "session-1", part: { type: "tool" } }),
    JSON.stringify({ type: "text", sessionID: "session-1", part: { type: "text", text: "检查完成。" } }),
  ].join("\n"));
  assert.equal(result.reply, "检查完成。");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(result.telemetry, { tool_use: 1, text: 1 });
});

test("开发入口提供 Pi Agent 默认值和可执行的 Kilo Code 选项", () => {
  const companion = join(process.cwd(), "examples", "companion");
  const html = readFileSync(join(companion, "web", "develop.html"), "utf8");
  const script = readFileSync(join(companion, "web", "assets", "develop-center.js"), "utf8");
  const server = readFileSync(join(companion, "server.ts"), "utf8");
  const plugins = readFileSync(join(companion, "development-engine-plugins.ts"), "utf8");
  assert.match(html, /id="developmentEngine"/);
  assert.match(html, /Pi Agent（默认）/);
  assert.match(html, /Kilo Code/);
  assert.match(script, /developmentEngine: developmentEngineValue\(\)/);
  assert.match(script, /function persistTaskSettings\(\)[\s\S]*updateDevelopmentEngineHint\(\);/);
  assert.match(server, /developmentEnginePlugins\.run\(developmentEngine/);
  assert.match(plugins, /manifest\("kilo", "Kilo Code", "@kilocode\/cli"\)/);
  assert.match(plugins, /runKiloDevelopment/);
});

test("Kilo Code headless 进程可通过当前兼容模型完成真实只读运行", { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-kilo-run-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "agent");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "# Mock project\n", "utf8");
  let requests = 0;
  const modelServer = createServer((req, res) => {
    if (req.method === "GET" && req.url?.includes("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
      return;
    }
    req.resume();
    req.on("end", () => {
      requests += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const first = {
        id: `mock-${requests}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "已完成 Kilo Code 真实适配检查。" }, finish_reason: null }],
      };
      const last = {
        ...first,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      };
      res.end(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((accept) => modelServer.listen(0, "127.0.0.1", accept));
  const address = modelServer.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runKiloDevelopment({
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
      agentDir,
    });
    assert.match(result.reply, /Kilo Code 真实适配检查/);
    assert.equal(result.accessMode, "inspect");
    assert.deepEqual(result.changedFiles, []);
    assert.ok(requests >= 1);
  } finally {
    await new Promise<void>((accept, reject) => modelServer.close((error) => error ? reject(error) : accept()));
    rmSync(root, { recursive: true, force: true });
  }
});
