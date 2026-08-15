import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  developmentApprovalPolicies,
  normalizeDevelopmentApprovalPolicy,
} from "../../examples/companion/development-approval.js";
import { runExternalDevelopment } from "../../examples/companion/external-development-engine.js";

test("不同开发引擎只暴露真实支持的批准方式", () => {
  assert.deepEqual(developmentApprovalPolicies("pi"), ["request", "auto"]);
  assert.deepEqual(developmentApprovalPolicies("codex"), ["request", "auto", "full"]);
  assert.equal(normalizeDevelopmentApprovalPolicy("kilo", "full"), "request");
  assert.equal(normalizeDevelopmentApprovalPolicy("codex", "full"), "full");
  assert.equal(normalizeDevelopmentApprovalPolicy("codex", "full", "inspect"), "request");
});

test("帮我批准会把隔离环境中的修改自动写回项目", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-auto-approval-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    execFileSync("git", ["init", workspace], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.invalid"], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "config", "user.name", "Clownfish Test"], { windowsHide: true });
    writeFileSync(join(workspace, "README.md"), "# Test\n", "utf8");
    execFileSync("git", ["-C", workspace, "add", "README.md"], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "commit", "-m", "initial"], { windowsHide: true });

    const result = await runExternalDevelopment({
      workspacePath: workspace,
      instruction: "新增结果文件",
      accessMode: "develop",
      approvalPolicy: "auto",
      connection: { provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", model: "mock", apiKey: "mock" },
      agentDir,
    }, {
      id: "mock",
      name: "Mock Engine",
      run: async ({ workspace: isolatedWorkspace }) => {
        writeFileSync(join(isolatedWorkspace, "result.txt"), "自动写入成功\n", "utf8");
        return { reply: "已完成。", toolCalls: 1, telemetry: { "mock/write": 1 } };
      },
    });

    assert.equal(result.approvalPolicy, "auto");
    assert.equal(result.proposal?.state, "applied");
    assert.equal(readFileSync(join(workspace, "result.txt"), "utf8"), "自动写入成功\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("请求批准只保留提案，不提前改动原项目", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-request-approval-"));
  const workspace = join(root, "workspace");
  try {
    execFileSync("git", ["init", workspace], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "config", "user.email", "test@example.invalid"], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "config", "user.name", "Clownfish Test"], { windowsHide: true });
    writeFileSync(join(workspace, "README.md"), "# Test\n", "utf8");
    execFileSync("git", ["-C", workspace, "add", "README.md"], { windowsHide: true });
    execFileSync("git", ["-C", workspace, "commit", "-m", "initial"], { windowsHide: true });

    const result = await runExternalDevelopment({
      workspacePath: workspace,
      instruction: "新增结果文件",
      accessMode: "develop",
      approvalPolicy: "request",
      connection: { provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", model: "mock", apiKey: "mock" },
      agentDir: join(root, "agent"),
    }, {
      id: "mock",
      name: "Mock Engine",
      run: async ({ workspace: isolatedWorkspace }) => {
        writeFileSync(join(isolatedWorkspace, "result.txt"), "等待批准\n", "utf8");
        return { reply: "已生成提案。", toolCalls: 1, telemetry: { "mock/write": 1 } };
      },
    });

    assert.equal(result.proposal?.state, "pending");
    assert.equal(existsSync(join(workspace, "result.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
