import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DevelopmentProposalStore } from "../../examples/companion/development-proposals.js";
import {
  buildDshSettings,
  dshDevelopmentEnvironment,
  resolveDshEntrypoint,
  runDshDevelopment,
  stageDshWorkspaceChanges,
} from "../../examples/companion/dsh-development.js";

test("DSH 设置复用小丑鱼模型连接但不落盘密钥", () => {
  const settings = buildDshSettings({
    provider: "custom",
    protocol: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    apiKey: "secret-should-not-appear",
  });
  assert.match(settings, /provider: clownfish/);
  assert.match(settings, /apiKeyEnv: CLOWNFISH_DSH_API_KEY/);
  assert.match(settings, /api: openai-completions/);
  assert.match(settings, /baseURL: "http:\/\/127\.0\.0\.1:1234\/v1"/);
  assert.match(settings, /model: "local-model"/);
  assert.doesNotMatch(settings, /secret-should-not-appear/);
});

test("已安装的 DSH CLI 可以被开发适配层发现", () => {
  const entrypoint = resolveDshEntrypoint();
  assert.ok(entrypoint?.endsWith(join("@deepseek-ai", "dsh", "lib", "bin.js")));
  assert.equal(dshDevelopmentEnvironment().available, true);
  assert.match(dshDevelopmentEnvironment().version, /0\.1\.0-rc\.6/);
});

test("DSH 修改先转成可审阅提案，再恢复隔离工作区", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-dsh-proposal-"));
  const original = join(root, "original");
  const staging = join(root, "staging");
  const data = join(root, "data");
  mkdirSync(original);
  mkdirSync(staging);
  writeFileSync(join(original, "app.ts"), "export const value = 1;\n", "utf8");
  writeFileSync(join(staging, "app.ts"), "export const value = 2;\n", "utf8");
  try {
    const session = new DevelopmentProposalStore(data).begin(original, "base", staging);
    stageDshWorkspaceChanges(session, staging, [{ path: "app.ts", operation: "update" }]);
    const proposal = session.finalize();
    assert.equal(proposal.state, "pending");
    assert.deepEqual(proposal.files.map((file) => file.path), ["app.ts"]);
    assert.equal(Buffer.from(proposal.files[0]!.proposedContentBase64, "base64").toString("utf8"), "export const value = 2;\n");
    assert.equal(readFileSync(join(staging, "app.ts"), "utf8"), "export const value = 1;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("标准开发入口展示已接通的五种编程引擎", () => {
  const companion = join(process.cwd(), "examples", "companion");
  const developHtml = readFileSync(join(companion, "web", "develop.html"), "utf8");
  const settingsHtml = readFileSync(join(companion, "web", "settings.html"), "utf8");
  const developScript = readFileSync(join(companion, "web", "assets", "develop-center.js"), "utf8");
  const server = readFileSync(join(companion, "server.ts"), "utf8");
  const plugins = readFileSync(join(companion, "development-engine-plugins.ts"), "utf8");
  assert.match(developHtml, /id="developmentEngine"/);
  assert.match(developHtml, /Pi Agent（默认）/);
  assert.match(developHtml, /DeepSeek Harness/);
  assert.match(developHtml, /Kilo Code/);
  assert.match(developHtml, /OpenCode/);
  assert.match(developHtml, /Codex/);
  assert.match(settingsHtml, /id="defaultDevelopmentEngine"/);
  assert.match(settingsHtml, /DeepSeek Harness/);
  assert.match(settingsHtml, /OpenCode/);
  assert.match(settingsHtml, /Codex/);
  assert.match(developScript, /developmentEngine: developmentEngineValue\(\)/);
  assert.match(server, /developmentEnginePlugins\.run\(developmentEngine/);
  assert.match(plugins, /manifest\("dsh", "DeepSeek Harness", "@deepseek-ai\/dsh"\)/);
  assert.match(plugins, /runDshDevelopment/);
});

test("DSH headless 进程可通过小丑鱼模型连接完成一次真实运行", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-dsh-run-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "# Mock project\n", "utf8");
  let requests = 0;
  const modelServer = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const chunk = {
        id: `mock-${requests}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "已完成真实适配检查。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      };
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((accept) => modelServer.listen(0, "127.0.0.1", accept));
  const address = modelServer.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runDshDevelopment({
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
    assert.match(result.reply, /真实适配检查/);
    assert.equal(result.accessMode, "inspect");
    assert.deepEqual(result.changedFiles, []);
    assert.ok(requests >= 1);
  } finally {
    await new Promise<void>((accept, reject) => modelServer.close((error) => error ? reject(error) : accept()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("DSH develop 在隔离 Git 工作区真实写文件并生成待审阅提案", { timeout: 90_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-dsh-develop-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "# Mock project\n", "utf8");
  execFileSync("git", ["init"], { cwd: workspace, windowsHide: true });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace, windowsHide: true });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: workspace, windowsHide: true });
  execFileSync("git", ["add", "README.md"], { cwd: workspace, windowsHide: true });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: workspace, windowsHide: true });
  let toolRound = 0;
  const modelServer = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const request = JSON.parse(raw || "{}") as { tools?: unknown[] };
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let delta: Record<string, unknown>;
      let finishReason = "stop";
      if (Array.isArray(request.tools) && request.tools.length > 0 && toolRound === 0) {
        toolRound += 1;
        finishReason = "tool_calls";
        delta = { role: "assistant", tool_calls: [{ index: 0, id: "call-read", type: "function", function: { name: "read", arguments: JSON.stringify({ file_path: "README.md" }) } }] };
      } else if (Array.isArray(request.tools) && request.tools.length > 0 && toolRound === 1) {
        toolRound += 1;
        finishReason = "tool_calls";
        delta = { role: "assistant", tool_calls: [{ index: 0, id: "call-write", type: "function", function: { name: "write", arguments: JSON.stringify({ file_path: "result.txt", content: "created by dsh\n" }) } }] };
      } else {
        delta = { role: "assistant", content: "已读取项目并创建 result.txt。" };
      }
      const chunk = {
        id: `mock-${toolRound}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      };
      res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise<void>((accept) => modelServer.listen(0, "127.0.0.1", accept));
  const address = modelServer.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await runDshDevelopment({
      workspacePath: workspace,
      instruction: "读取 README，然后创建 result.txt，内容为 created by dsh。",
      accessMode: "develop",
      connection: {
        provider: "custom",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "mock-model",
        apiKey: "mock-key",
      },
      agentDir: join(root, "agent"),
      proposalStore: new DevelopmentProposalStore(join(root, "proposals")),
    });
    assert.equal(toolRound, 2);
    assert.deepEqual(result.changedFiles, ["result.txt"]);
    assert.equal(result.proposal?.state, "pending");
    assert.equal(result.isolatedWorkspace, true);
    assert.equal(existsSync(join(workspace, "result.txt")), false);
  } finally {
    await new Promise<void>((accept, reject) => modelServer.close((error) => error ? reject(error) : accept()));
    rmSync(root, { recursive: true, force: true });
  }
});
