import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "examples", "companion");
const html = readFileSync(join(root, "web", "development.html"), "utf8");
const script = readFileSync(join(root, "web", "assets", "development-workbench.js"), "utf8");
const server = readFileSync(join(root, "server.ts"), "utf8");

test("项目工作台提供文件树、逐文件审阅、运行证据和恢复入口", () => {
  assert.match(html, /本次修改/);
  assert.match(html, /项目文件/);
  assert.match(html, /运行与检查记录/);
  assert.match(html, /本机环境/);
  assert.match(html, /恢复写入前/);
  assert.match(script, /selectedPaths/);
  assert.match(script, /continueProposal/);
  assert.match(script, /api\/development\/workspace/);
});

test("运行中的开发任务从持久作业检查点投影，不在页面猜测状态", () => {
  assert.match(script, /api\/agent\/job\?id=/);
  assert.match(script, /job\.checkpoints/);
  assert.match(script, /location\.reload\(\)/);
  assert.match(server, /job\?\.payload\?\.capabilityId === "project-development"/);
});

test("开发结果页按执行权限解释是否已经修改项目", () => {
  assert.match(script, /approvalPolicy === "full"/);
  assert.match(script, /完全控制可能已经留下部分修改/);
  assert.match(script, /完全控制会直接修改当前项目，不经过修改提案/);
  assert.match(script, /只读检查不会修改项目文件/);
});
