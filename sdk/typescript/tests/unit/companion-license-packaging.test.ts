import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..", "..");
const buildScript = readFileSync(
  join(repoRoot, "sdk", "typescript", "examples", "companion", "client", "Build-Clownfish.ps1"),
  "utf8",
);
const licensing = readFileSync(join(repoRoot, "LICENSING.md"), "utf8");
const notices = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");

test("便携包携带项目和第三方授权文件", () => {
  assert.match(buildScript, /"LICENSE", "LICENSING\.md", "THIRD_PARTY_NOTICES\.md"/);
  assert.match(buildScript, /Node\.js-LICENSE\.txt/);
  assert.match(buildScript, /Python-LICENSE\.txt/);
  assert.match(buildScript, /Clownfish-LICENSE\.txt/);
  assert.match(buildScript, /PortableLicenses.*webview2/s);
});

test("便携包包含实际运行所需的开源文档引擎及其目录内许可证", () => {
  assert.match(buildScript, /examples\\companion\\vendor/);
  assert.match(buildScript, /Copy-Item -LiteralPath \$CompanionVendor -Destination \$PortableCompanion -Recurse -Force/);
});

test("公开授权说明不把仓库整体误称为单一开源许可证项目", () => {
  assert.match(licensing, /708 个唯一的“包名 \+ 版本”条目/);
  assert.match(licensing, /LGPL-3\.0-or-later/);
  assert.match(notices, /本仓库的许可证不会覆盖或替代这些条款/);
  assert.match(notices, /Pi Agent/);
  assert.match(notices, /OpenAI Codex CLI/);
});
