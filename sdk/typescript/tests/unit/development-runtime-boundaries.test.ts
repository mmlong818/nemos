import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DevelopmentJsonlEventStream } from "../../examples/companion/development-jsonl-stream.js";
import {
  decodeDevelopmentSessionReference,
  encodeDevelopmentSessionReference,
} from "../../examples/companion/development-session-reference.js";
import {
  detachedProcessGroup,
  processTreeTerminationCommand,
} from "../../examples/companion/child-process-lifecycle.js";

test("开发会话引用只接受对应引擎 runs 目录内的位置", () => {
  const agentDir = mkdtempSync(resolve(tmpdir(), "nemos-session-ref-"));
  const runHome = resolve(agentDir, "runs", "run-1");
  mkdirSync(runHome, { recursive: true });
  const encoded = encodeDevelopmentSessionReference("codex", runHome, "thread-1");
  assert.deepEqual(decodeDevelopmentSessionReference(encoded, "codex", agentDir), { runHome, sessionId: "thread-1" });
  assert.equal(decodeDevelopmentSessionReference(encoded, "kilo", agentDir), undefined);

  const outside = encodeDevelopmentSessionReference("codex", resolve(agentDir, "outside"), "thread-2");
  assert.equal(decodeDevelopmentSessionReference(outside, "codex", agentDir), undefined);
});

test("JSONL 事件流支持分块输入且忽略普通文本", () => {
  const events: Array<{ type: string; toolName?: string }> = [];
  const stream = new DevelopmentJsonlEventStream((event) => events.push(event));
  stream.push('{"type":"item.started","item":{"type":"command_execution","name":"shell"}}\n普通');
  stream.push('文本\n{"type":"item.completed","tool_name":"write_file"}');
  stream.flush();
  assert.deepEqual(events.map(({ type, toolName }) => ({ type, toolName })), [
    { type: "item.started", toolName: "shell" },
    { type: "item.completed", toolName: "write_file" },
  ]);
});

test("取消开发任务会按平台停止完整进程树", () => {
  assert.deepEqual(processTreeTerminationCommand(123, "win32"), {
    command: "taskkill",
    args: ["/PID", "123", "/T", "/F"],
    killProcessGroup: false,
  });
  assert.equal(processTreeTerminationCommand(123, "linux").killProcessGroup, true);
  assert.equal(detachedProcessGroup("win32"), false);
  assert.equal(detachedProcessGroup("linux"), true);
});
