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
  assert.match(buildScript, /Get-ChildItem -LiteralPath \(Join-Path \$SdkRoot "examples\\companion"\) -Directory/);
  assert.match(buildScript, /\.Name -notin @\("client", "docs"\)/);
  assert.match(notices, /vendor\/docx-engine/);
  assert.match(notices, /vendor\/pptx-engine/);
});

test("Buzz 适配代码保留上游许可和固定提交，并沿用随包目录规则", () => {
  const companion = join(repoRoot, "sdk", "typescript", "examples", "companion");
  const source = readFileSync(join(companion, "web", "assets", "agent-events.js"), "utf8");
  const license = readFileSync(join(companion, "vendor", "buzz", "LICENSE"), "utf8");
  const provenance = readFileSync(join(companion, "vendor", "buzz", "README.md"), "utf8");
  assert.match(source, /Copyright 2026 Block, Inc/);
  assert.match(source, /Modified 2026-09-06/);
  assert.match(license, /Apache License[\s\S]*Version 2\.0/);
  assert.match(license, /Copyright 2026 Block, Inc/);
  assert.match(provenance, /3c7f288c60d67df78577b237e27c3dfc8831aaa1/);
  assert.match(notices, /vendor\/buzz/);
  assert.match(buildScript, /\.Name -notin @\("client", "docs"\)/);
});

test("公开授权说明不把仓库整体误称为单一开源许可证项目", () => {
  assert.match(licensing, /唯一的“包名 \+ 版本”条目/);
  assert.match(licensing, /LGPL-3\.0-or-later/);
  assert.match(notices, /本仓库的许可证不会覆盖或替代这些条款/);
  assert.doesNotMatch(notices, /Pi Agent|OpenAI Codex CLI/);
});
