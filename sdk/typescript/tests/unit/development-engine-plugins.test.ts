import assert from "node:assert/strict";
import test from "node:test";
import {
  DevelopmentEnginePluginRegistry,
  type DevelopmentEnginePlugin,
} from "../../examples/companion/development-engine-plugins.js";
import { DEVELOPMENT_ENGINES, normalizeDevelopmentEngine } from "../../examples/companion/development-engine-contract.js";
import { piDevelopmentEnvironment } from "../../examples/companion/pi-development.js";

function plugins(onRun?: (id: string) => void): DevelopmentEnginePlugin[] {
  return DEVELOPMENT_ENGINES.map((id) => ({
    manifest: {
      id,
      name: id,
      packageName: `package-${id}`,
      integration: "package-adapter",
      default: id === "pi",
      presentation: {
        tagline: `${id}-tagline`,
        bestFor: `${id}-best-for`,
      },
      capabilities: {
        sessionResume: id === "pi",
        structuredEvents: id !== "dsh",
        isolatedWorkspace: id === "dsh" || id === "kilo" || id === "opencode",
        eventDelivery: id === "pi" ? "live" : id === "dsh" ? "summary-only" : "after-run",
        isolation: id === "dsh" || id === "kilo" || id === "opencode" ? "develop-only" : "best-effort",
      },
    },
    readiness: () => ({ available: true, version: "1.0.0" }),
    run: async () => {
      onRun?.(id);
      return { reply: id } as never;
    },
  }));
}

test("开发引擎插件注册表保持统一顺序并暴露依赖来源", () => {
  const registry = new DevelopmentEnginePluginRegistry(plugins());
  assert.deepEqual(registry.list().map((item) => item.id), [...DEVELOPMENT_ENGINES]);
  assert.equal(registry.list()[0]?.packageName, "package-pi");
  assert.equal(registry.list()[0]?.capabilities.eventDelivery, "live");
  assert.equal(registry.list()[0]?.presentation.tagline, "pi-tagline");
  assert.equal(registry.list().find((item) => item.id === "dsh")?.capabilities.structuredEvents, false);
  assert.equal(registry.list().find((item) => item.id === "codex")?.capabilities.isolatedWorkspace, false);
  assert.equal(registry.readiness().codex.available, true);
});

test("Pi Agent 就绪状态来自实际安装包", () => {
  const readiness = piDevelopmentEnvironment();
  assert.equal(readiness.available, true);
  assert.match(readiness.version, /Pi Agent \d+/);
});

test("开发引擎插件注册表把执行交给选中的适配器", async () => {
  const calls: string[] = [];
  const registry = new DevelopmentEnginePluginRegistry(plugins((id) => calls.push(id)));
  const result = await registry.run("opencode", {} as never);
  assert.equal(result.reply, "opencode");
  assert.deepEqual(calls, ["opencode"]);
});

test("开发引擎插件注册表拒绝缺失和重复插件", () => {
  assert.throws(() => new DevelopmentEnginePluginRegistry(plugins().slice(1)), /插件缺失：pi/);
  assert.throws(() => new DevelopmentEnginePluginRegistry([...plugins(), plugins()[0]!]), /插件重复：pi/);
  assert.equal(normalizeDevelopmentEngine("unknown"), "pi");
});
