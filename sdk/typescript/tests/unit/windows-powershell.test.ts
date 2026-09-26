import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { windowsPowerShellPath } from "../../examples/companion/windows-powershell.js";

// 真实问题：桌面客户端收窄了 PATH，按名字找不到 powershell.exe，DPAPI 解密失败，桌面版一直是离线模式。
test("powershell.exe 按系统目录给完整路径，不依赖 PATH；找不到才退回按名字", () => {
  const seen: string[] = [];
  const found = windowsPowerShellPath({ SystemRoot: "C:\\Windows", PATH: "D:\\app\\node" }, (path) => { seen.push(path); return true; });
  assert.equal(found, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(windowsPowerShellPath({ windir: "E:\\Win" }, () => true), "E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(windowsPowerShellPath({}, () => false), "powershell.exe");
});

test("服务端所有调 PowerShell 的地方都走完整路径，不再按名字调用", () => {
  for (const file of ["examples/companion/server.ts", "examples/companion/private-source-connectors.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /execFileSync\("powershell(\.exe)?"/, file);
    assert.match(source, /execFileSync\(windowsPowerShellPath\(\)/, file);
  }
});
