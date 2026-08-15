import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createManagedDevelopmentProject,
  ensureDevelopmentProjectsRoot,
  extractDevelopmentWorkspaceReference,
} from "../../examples/companion/development-projects.js";

test("新开发任务在默认根目录中创建独立项目", () => {
  const temp = mkdtempSync(join(tmpdir(), "clownfish-projects-"));
  try {
    const root = ensureDevelopmentProjectsRoot(join(temp, "小丑鱼项目"));
    const first = createManagedDevelopmentProject(root, "做一个客户管理工具");
    const second = createManagedDevelopmentProject(root, "做一个客户管理工具");
    assert.equal(first.name, "做一个客户管理工具");
    assert.equal(second.name, "做一个客户管理工具-2");
    assert.notEqual(first.path, second.path);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("任务说明中的外部项目目录会被直接识别", () => {
  const temp = mkdtempSync(join(tmpdir(), "clownfish-external-project-"));
  try {
    const project = ensureDevelopmentProjectsRoot(join(temp, "existing project"));
    assert.equal(extractDevelopmentWorkspaceReference(`项目目录：${project}\n请修复首页按钮`), project);
    assert.equal(extractDevelopmentWorkspaceReference(`请处理项目 "${project}"`), project);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
