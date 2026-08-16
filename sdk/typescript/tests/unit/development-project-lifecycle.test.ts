import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AgentJobRecord } from "../../src/index.js";
import {
  DevelopmentProjectArchiveStore,
  deleteManagedDevelopmentWorkspace,
  developmentProjectThreads,
  managedDevelopmentWorkspace,
} from "../../examples/companion/development-project-lifecycle.js";

function job(id: string, createdAt: string, parentJobId = ""): AgentJobRecord {
  return {
    id,
    type: "capability-adhoc",
    payload: { capabilityId: "project-development", title: "测试项目", parentJobId },
    status: "succeeded",
    attempts: 1,
    createdAt,
    updatedAt: createdAt,
    availableAt: createdAt,
    checkpoints: [],
  };
}

test("persists archive records and restores them without changing project data", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-project-archive-"));
  try {
    const file = join(dir, "archive.json");
    const store = new DevelopmentProjectArchiveStore(file);
    store.archive({ rootJobId: "job-root", title: "网站项目", workspacePath: "C:\\projects\\site" });
    assert.equal(new DevelopmentProjectArchiveStore(file).get("job-root")?.title, "网站项目");
    assert.equal(store.restore("job-root"), true);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("groups continuation jobs into one development project", () => {
  const first = job("root", "2026-08-15T01:00:00.000Z");
  const second = job("child", "2026-08-15T02:00:00.000Z", "root");
  const threads = developmentProjectThreads([second, first]);
  assert.equal(threads.length, 1);
  assert.equal(threads[0]?.root.id, "root");
  assert.equal(threads[0]?.latest.id, "child");
  assert.deepEqual(threads[0]?.turns.map((item) => item.id), ["root", "child"]);
});

test("only deletes directories strictly inside the managed projects root", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-managed-projects-"));
  const root = join(dir, "projects");
  const managed = join(root, "managed-project");
  const external = join(dir, "external-project");
  try {
    mkdirSync(managed, { recursive: true });
    mkdirSync(external, { recursive: true });
    writeFileSync(join(managed, "keep.txt"), "managed");
    writeFileSync(join(external, "keep.txt"), "external");
    assert.equal(managedDevelopmentWorkspace(root, managed), managed);
    assert.equal(managedDevelopmentWorkspace(root, root), undefined);
    assert.equal(managedDevelopmentWorkspace(root, external), undefined);
    assert.equal(deleteManagedDevelopmentWorkspace(root, external), false);
    assert.equal(existsSync(external), true);
    assert.equal(deleteManagedDevelopmentWorkspace(root, managed), true);
    assert.equal(existsSync(managed), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("删除中文命名的项目目录（rmSync 在部分 Windows 上会中止进程）", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-managed-cjk-"));
  const root = join(dir, "projects");
  const managed = join(root, "检查我本机的wifi状态-3");
  try {
    mkdirSync(join(managed, "src"), { recursive: true });
    writeFileSync(join(managed, "src", "检查.ts"), "export {};\n");
    writeFileSync(join(managed, "说明.md"), "# 项目\n");
    assert.equal(deleteManagedDevelopmentWorkspace(root, managed), true);
    assert.equal(existsSync(managed), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
