// development-check-matrix.test.ts — v0.8 按项目探测检查矩阵
//
// 验证：只暴露这个项目真正适用的检查；包管理器按 lockfile 判定；
//       package.json 里没有的脚本不暴露；白名单边界没有因为「扩宽」而放开。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectDevelopmentChecks } from "../../examples/companion/pi-development.js";

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-matrix-"));
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  return dir;
}

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

test("Node 项目按 lockfile 判定包管理器", () => {
  const npm = workspace({ "package.json": pkg({ test: "x" }), "package-lock.json": "{}" });
  const pnpm = workspace({ "package.json": pkg({ test: "x" }), "pnpm-lock.yaml": "" });
  const yarn = workspace({ "package.json": pkg({ test: "x" }), "yarn.lock": "" });
  try {
    assert.ok(detectDevelopmentChecks(npm, "develop").includes("npm_test"));
    assert.ok(detectDevelopmentChecks(pnpm, "develop").includes("pnpm_test"));
    assert.ok(detectDevelopmentChecks(yarn, "develop").includes("yarn_test"));
    // 判定出一个就不该再冒出别的包管理器。
    assert.ok(!detectDevelopmentChecks(pnpm, "develop").includes("npm_test"));
  } finally {
    for (const dir of [npm, pnpm, yarn]) rmSync(dir, { recursive: true, force: true });
  }
});

test("package.json 里没有的脚本不暴露", () => {
  const dir = workspace({ "package.json": pkg({ test: "x" }), "package-lock.json": "{}" });
  try {
    const checks = detectDevelopmentChecks(dir, "develop");
    assert.ok(checks.includes("npm_test"));
    // 之前是硬编码枚举，build/typecheck/check 一律提供，模型跑出来只会拿到包管理器的报错。
    assert.ok(!checks.includes("npm_build"));
    assert.ok(!checks.includes("npm_typecheck"));
    assert.ok(!checks.includes("npm_check"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Rust / Go / Java / .NET / Python 各按标志文件探测", () => {
  const cases: Array<[Record<string, string>, string[], string[]]> = [
    [{ "Cargo.toml": "" }, ["cargo_test", "cargo_check", "cargo_clippy"], ["go_test", "npm_test"]],
    [{ "go.mod": "module x" }, ["go_test", "go_build", "go_vet"], ["cargo_test"]],
    [{ "pom.xml": "<project/>" }, ["maven_test", "maven_verify"], ["gradle_test"]],
    [{ "build.gradle.kts": "" }, ["gradle_test", "gradle_build"], ["maven_test"]],
    [{ "global.json": "{}" }, ["dotnet_test", "dotnet_build"], ["cargo_test"]],
    [{ "pyproject.toml": "" }, ["pytest", "ruff_check", "mypy"], ["cargo_test"]],
  ];
  for (const [files, expected, absent] of cases) {
    const dir = workspace(files);
    try {
      const checks = detectDevelopmentChecks(dir, "develop");
      for (const id of expected) assert.ok(checks.includes(id), `${JSON.stringify(files)} 应当探测到 ${id}`);
      for (const id of absent) assert.ok(!checks.includes(id), `${JSON.stringify(files)} 不该探测到 ${id}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("空项目只剩只读检查，混合项目两套都在", () => {
  const empty = workspace({ "README.md": "# 空\n" });
  const mixed = workspace({
    "package.json": pkg({ build: "x" }),
    "package-lock.json": "{}",
    "Cargo.toml": "",
  });
  try {
    assert.deepEqual(detectDevelopmentChecks(empty, "develop"), ["git_status", "git_diff"]);
    const checks = detectDevelopmentChecks(mixed, "develop");
    assert.ok(checks.includes("npm_build"));
    assert.ok(checks.includes("cargo_test"));
  } finally {
    for (const dir of [empty, mixed]) rmSync(dir, { recursive: true, force: true });
  }
});

test("只读模式下无论项目是什么都只有 Git 两项", () => {
  const dir = workspace({
    "package.json": pkg({ test: "x", build: "y" }),
    "package-lock.json": "{}",
    "Cargo.toml": "",
    "go.mod": "module x",
  });
  try {
    assert.deepEqual(detectDevelopmentChecks(dir, "inspect"), ["git_status", "git_diff"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
