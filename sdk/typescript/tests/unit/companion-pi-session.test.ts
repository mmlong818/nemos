// companion-pi-session.test.ts — v0.8 开发会话持久化
//
// 验证：同一工作区的后续指令接着上一轮的会话做、new 能另起一条、
//       resume 能按 sessionFile 精确恢复，以及缺参数时直接报错而不是静默新建。

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runPiDevelopment,
  type PiDevelopmentResult,
} from "../../examples/companion/pi-development.js";

const chunk = (delta: unknown, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

/**
 * 每轮开发正好两次请求：先要一次工具调用，再给最终回复。
 * 按奇偶应答，同一个服务可以连续服务多轮。
 */
function createModelServer(): Server {
  let requests = 0;
  return createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if (requests % 2 === 1) {
      res.write(
        chunk(
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${requests}`,
                type: "function",
                function: { name: "list_files", arguments: '{"path":".","depth":1}' },
              },
            ],
          },
          null,
        ),
      );
      res.write(chunk({}, "tool_calls"));
    } else {
      res.write(chunk({ role: "assistant", content: "已检查测试项目。" }, null));
      res.write(chunk({}, "stop"));
    }
    res.end("data: [DONE]\n\n");
  });
}

test("开发会话落盘：同一工作区续期、另起与精确恢复", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "clownfish-session-workspace-"));
  const agentDir = mkdtempSync(join(tmpdir(), "clownfish-session-agent-"));
  writeFileSync(join(workspace, "README.md"), "# 测试项目\n", "utf8");
  const server = createModelServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const run = (
    overrides: Partial<Parameters<typeof runPiDevelopment>[0]> = {},
  ): Promise<PiDevelopmentResult> =>
    runPiDevelopment({
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
      ...overrides,
    });

  try {
    // 第一轮：没有历史会话，落盘一条新的。
    const first = await run();
    assert.equal(first.sessionResumed, false);
    assert.ok(first.sessionId);
    assert.ok(first.sessionFile, "会话必须落盘，否则中断后无法恢复");
    assert.equal(existsSync(first.sessionFile as string), true);

    // 第二轮：默认 continue，接着上一条往下做。
    const second = await run();
    assert.equal(second.sessionResumed, true, "同一工作区的后续指令应当接续上一轮");
    assert.equal(second.sessionId, first.sessionId);

    // 显式 new：另起一条，不带入上一轮上下文。
    const fresh = await run({ sessionMode: "new" });
    assert.equal(fresh.sessionResumed, false);
    assert.notEqual(fresh.sessionId, first.sessionId);

    // resume：按文件精确回到第一条会话，而不是最近那条。
    const resumed = await run({ sessionMode: "resume", sessionFile: first.sessionFile });
    assert.equal(resumed.sessionResumed, true);
    assert.equal(resumed.sessionId, first.sessionId);

    // 缺 sessionFile 时直接报错——静默新建会让「恢复」变成悄悄丢上下文。
    await assert.rejects(() => run({ sessionMode: "resume" }), /需要上一轮返回的 sessionFile/);
    await assert.rejects(
      () => run({ sessionMode: "resume", sessionFile: join(agentDir, "not-here.jsonl") }),
      /已不存在/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(workspace, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
  }
});
