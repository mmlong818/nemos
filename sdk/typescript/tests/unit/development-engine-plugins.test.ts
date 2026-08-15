import assert from "node:assert/strict";
import test from "node:test";
import {
  DevelopmentEnginePluginRegistry,
  type DevelopmentEnginePlugin,
} from "../../examples/companion/development-engine-plugins.js";
import { DEVELOPMENT_ENGINES, normalizeDevelopmentEngine } from "../../examples/companion/development-engine-contract.js";

function plugins(onRun?: (id: string) => void): DevelopmentEnginePlugin[] {
  return DEVELOPMENT_ENGINES.map((id) => ({
    manifest: {
      id,
      name: id,
      packageName: `package-${id}`,
      integration: "package-adapter",
      default: id === "pi",
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
  assert.equal(registry.readiness().codex.available, true);
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
