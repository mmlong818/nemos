import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPiDevelopment, validateDevelopmentWorkspace } from "../../examples/companion/pi-development.js";

test("开发能力拒绝磁盘根目录和不存在的路径", () => {
  assert.throws(() => validateDevelopmentWorkspace("C:\\"), /整个磁盘/);
  assert.throws(() => validateDevelopmentWorkspace(join(tmpdir(), "missing-clownfish-workspace")), /不存在/);
});

test("开发能力可通过 Pi Agent SDK 使用现有兼容模型连接", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "clownfish-pi-workspace-"));
  const agentDir = mkdtempSync(join(tmpdir(), "clownfish-pi-agent-"));
  writeFileSync(join(workspace, "README.md"), "# 测试项目\n", "utf8");
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests === 1) {
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "list_files", arguments: "{\"path\":\".\",\"depth\":1}" } }] }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "已检查测试项目。" }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const result = await runPiDevelopment({
      workspacePath: workspace,
      instruction: "检查项目入口",
      accessMode: "inspect",
      agentDir,
      connection: {
        provider: "custom",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "test-model",
        apiKey: "test-key",
      },
    });
    assert.equal(result.reply, "已检查测试项目。");
    assert.equal(result.accessMode, "inspect");
    assert.equal(result.toolCalls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workspace, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
