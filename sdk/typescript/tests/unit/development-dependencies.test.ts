import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { detectDevelopmentDependencies } from "../../examples/companion/development-dependencies.js";

test("开发依赖只根据项目声明生成受控安装计划", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-deps-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "1.0.0" } }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
    writeFileSync(join(dir, "requirements.txt"), "requests==2.32.0");
    const plans = detectDevelopmentDependencies(dir);
    assert.deepEqual(plans.map((plan) => plan.ecosystem), ["node", "python"]);
    assert.deepEqual(plans.flatMap((plan) => plan.steps).map((step) => [step.command, ...step.args]), [
      ["pnpm", "install", "--frozen-lockfile"],
      [process.platform === "win32" ? "python" : "python3", "-m", "venv", ".venv"],
      [join(".venv", process.platform === "win32" ? join("Scripts", "python.exe") : join("bin", "python")), "-m", "pip", "install", "-r", "requirements.txt"],
    ]);
    mkdirSync(join(dir, "node_modules"));
    mkdirSync(join(dir, ".venv"));
    assert.equal(detectDevelopmentDependencies(dir).some((plan) => plan.needed), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("没有项目声明时不会猜测或全局安装依赖", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-deps-empty-"));
  try { assert.deepEqual(detectDevelopmentDependencies(dir), []); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
