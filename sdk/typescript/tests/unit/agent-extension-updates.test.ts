import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentExtensionRegistry, type AgentExtensionManifest } from "../../src/index.js";
import { AgentExtensionUpdateService, analyzeExtensionUpdate } from "../../examples/companion/agent-extension-updates.js";

function manifest(version: string, permissions: AgentExtensionManifest["permissions"] = ["network"]): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "weather.remote",
    name: "天气连接器",
    version,
    description: "查询天气",
    kind: "connector",
    source: { type: "url", location: "https://example.com/weather-manifest.json" },
    runtime: { type: "http" },
    permissions,
    activation: ["天气"],
    tools: [{ name: "lookup", description: "查询天气", effect: "read" }],
  };
}

test("扩展更新分析会区分兼容更新和权限扩张", () => {
  assert.equal(analyzeExtensionUpdate(manifest("1.0.0"), manifest("1.1.0"), [], "now").risk, "compatible");
  const risky = analyzeExtensionUpdate(manifest("1.0.0"), manifest("2.0.0", ["network", "filesystem-read"]), ["filesystem-read"], "now");
  assert.equal(risky.risk, "review");
  assert.match(risky.reasons.join(" "), /主版本.*新增权限/);
});

test("远端扩展检查后可升级，且风险更新必须确认", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-extension-update-"));
  const registry = new AgentExtensionRegistry(join(dir, "extensions.json"));
  registry.install(manifest("1.0.0"));
  let latest = manifest("1.1.0");
  const service = new AgentExtensionUpdateService({
    registry,
    stateFile: join(dir, "updates.json"),
    createProvider: () => undefined,
    fetchManifest: async () => ({ manifest: latest, raw: JSON.stringify(latest) }),
  });
  try {
    const checked = await service.check();
    assert.equal(checked.items[0]?.updateAvailable, true);
    assert.equal(checked.items[0]?.risk, "compatible");
    await service.upgrade({ id: latest.id, latestVersion: latest.version });
    assert.equal(registry.get(latest.id)?.manifest.version, "1.1.0");

    latest = manifest("2.0.0", ["network", "filesystem-read"]);
    const risky = await service.check();
    assert.equal(risky.items[0]?.risk, "review");
    await assert.rejects(
      service.upgrade({ id: latest.id, latestVersion: latest.version }),
      /明确确认/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
