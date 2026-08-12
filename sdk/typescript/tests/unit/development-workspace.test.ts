import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listDevelopmentWorkspace, readDevelopmentWorkspaceFile } from "../../examples/companion/development-workspace.js";

test("项目文件树跳过依赖、密钥和符号链接", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-dev-tree-"));
  const outside = mkdtempSync(join(tmpdir(), "clownfish-dev-outside-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(root, "src", "app.ts"), "export {};\n");
    writeFileSync(join(root, ".env"), "SECRET=1\n");
    writeFileSync(join(root, "node_modules", "pkg", "index.js"), "ignored\n");
    writeFileSync(join(outside, "outside.txt"), "outside\n");
    try { symlinkSync(join(outside, "outside.txt"), join(root, "linked.txt")); } catch { /* Windows 无创建符号链接权限时仍验证其他边界。 */ }
    const result = listDevelopmentWorkspace(root);
    assert.deepEqual(result.files.map((file) => file.path), ["src/app.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("项目文件读取拒绝越界、密钥和非文本文件", () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-dev-read-"));
  try {
    writeFileSync(join(root, "README.md"), "# 项目\n", "utf8");
    writeFileSync(join(root, ".env.local"), "SECRET=1\n", "utf8");
    writeFileSync(join(root, "image.png"), Buffer.from([1, 2, 3]));
    assert.equal(readDevelopmentWorkspaceFile(root, "README.md").content, "# 项目\n");
    assert.throws(() => readDevelopmentWorkspaceFile(root, "../outside.txt"), /项目范围/);
    assert.throws(() => readDevelopmentWorkspaceFile(root, ".env.local"), /项目范围/);
    assert.throws(() => readDevelopmentWorkspaceFile(root, "image.png"), /文本查看/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
