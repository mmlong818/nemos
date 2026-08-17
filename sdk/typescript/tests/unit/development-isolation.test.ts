import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareIsolatedDevelopmentWorkspace, prepareReadOnlyDevelopmentWorkspace } from "../../examples/companion/pi-development.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, {
    cwd,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "Clownfish Test", GIT_AUTHOR_EMAIL: "test@localhost", GIT_COMMITTER_NAME: "Clownfish Test", GIT_COMMITTER_EMAIL: "test@localhost" },
  });
}

test("干净 Git 项目在独立工作树中执行并在结束后清理", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-isolation-"));
  const repository = join(root, "repository");
  const agentDir = join(root, "agent");
  try {
    git(root, "init", repository);
    writeFileSync(join(repository, "index.ts"), "export const value = 1;\n", "utf8");
    git(repository, "add", "index.ts");
    git(repository, "commit", "-m", "fixture");
    const isolated = await prepareIsolatedDevelopmentWorkspace(repository, agentDir);
    assert.equal(isolated.isolated, true);
    assert.notEqual(isolated.workspace, repository);
    writeFileSync(join(isolated.workspace, "index.ts"), "export const value = 2;\n", "utf8");
    assert.equal(readFileSync(join(repository, "index.ts"), "utf8"), "export const value = 1;\n");
    const isolatedPath = isolated.workspace;
    await isolated.cleanup();
    assert.equal(existsSync(isolatedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("存在未提交修改时不创建隔离副本，避免丢失用户当前上下文", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-isolation-dirty-"));
  const repository = join(root, "repository");
  try {
    git(root, "init", repository);
    writeFileSync(join(repository, "index.ts"), "base\n", "utf8");
    git(repository, "add", "index.ts");
    git(repository, "commit", "-m", "fixture");
    writeFileSync(join(repository, "index.ts"), "user edit\n", "utf8");
    const isolated = await prepareIsolatedDevelopmentWorkspace(repository, join(root, "agent"));
    assert.equal(isolated.isolated, false);
    assert.equal(isolated.reason, "dirty");
    assert.equal(isolated.workspace, repository);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("全新空目录自动初始化 Git 后再建立隔离副本", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-isolation-empty-"));
  const workspace = join(root, "fresh-project");
  try {
    mkdirSync(workspace, { recursive: true });
    const isolated = await prepareIsolatedDevelopmentWorkspace(workspace, join(root, "agent"));
    assert.equal(isolated.isolated, true);
    assert.notEqual(isolated.workspace, workspace);
    // 原目录已成为干净的 Git 项目，隔离副本里的提交来自初始化
    const log = execFileSync("git", ["-C", workspace, "log", "--oneline"], { windowsHide: true, encoding: "utf8" });
    assert.match(log, /chore: initialize project/);
    const isolatedPath = isolated.workspace;
    await isolated.cleanup();
    assert.equal(existsSync(isolatedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("有内容的非 Git 目录不擅自初始化，报告 not-a-repo", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-isolation-plain-"));
  const workspace = join(root, "plain");
  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "notes.txt"), "user content\n", "utf8");
    const isolated = await prepareIsolatedDevelopmentWorkspace(workspace, join(root, "agent"));
    assert.equal(isolated.isolated, false);
    assert.equal(isolated.reason, "not-a-repo");
    // 目录没有被初始化为 Git 项目
    assert.equal(existsSync(join(workspace, ".git")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("只读检查使用一次性副本并排除依赖、Git 元数据和符号链接", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-inspect-snapshot-"));
  const workspace = join(root, "workspace");
  const agentDir = join(root, "agent");
  try {
    mkdirSync(join(workspace, "node_modules", "ignored"), { recursive: true });
    mkdirSync(join(workspace, ".git"), { recursive: true });
    writeFileSync(join(workspace, "source.txt"), "original\n", "utf8");
    writeFileSync(join(workspace, "node_modules", "ignored", "index.js"), "ignored", "utf8");
    const isolated = await prepareReadOnlyDevelopmentWorkspace(workspace, agentDir);
    assert.equal(readFileSync(join(isolated.workspace, "source.txt"), "utf8"), "original\n");
    assert.equal(existsSync(join(isolated.workspace, "node_modules")), false);
    assert.equal(existsSync(join(isolated.workspace, ".git")), false);
    writeFileSync(join(isolated.workspace, "source.txt"), "engine edit\n", "utf8");
    assert.equal(readFileSync(join(workspace, "source.txt"), "utf8"), "original\n");
    const isolatedPath = isolated.workspace;
    await isolated.cleanup();
    assert.equal(existsSync(isolatedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
