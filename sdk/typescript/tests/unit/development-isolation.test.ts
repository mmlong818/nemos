import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareIsolatedDevelopmentWorkspace } from "../../examples/companion/pi-development.js";

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
    assert.equal(isolated.workspace, repository);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
