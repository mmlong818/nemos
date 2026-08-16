import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DevelopmentEnginePluginRegistry, type DevelopmentEnginePlugin } from "../../examples/companion/development-engine-plugins.js";
import { DEVELOPMENT_ENGINES } from "../../examples/companion/development-engine-contract.js";
import { analyzeDevelopmentEngineUpdate, DevelopmentEngineUpdateService } from "../../examples/companion/development-engine-updates.js";

function registry(): DevelopmentEnginePluginRegistry {
  return new DevelopmentEnginePluginRegistry(DEVELOPMENT_ENGINES.map((id) => ({
    manifest: {
      id,
      name: id,
      packageName: `package-${id}`,
      integration: "package-adapter",
      default: id === "pi",
      presentation: { tagline: id, bestFor: id },
      capabilities: { sessionResume: false, structuredEvents: false, isolatedWorkspace: false, eventDelivery: "summary-only", isolation: "best-effort" },
    },
    readiness: () => ({ available: true, version: `${id} 1.2.3` }),
    run: async () => ({ reply: id }) as never,
  } satisfies DevelopmentEnginePlugin)));
}

test("同主版本、命令入口与 Node 环境不变时可以提示安全升级", () => {
  const item = analyzeDevelopmentEngineUpdate({
    engine: "codex",
    name: "Codex",
    packageName: "@openai/codex",
    currentVersion: "1.2.3",
    metadata: { version: "1.3.0", engines: { node: ">=22" }, bin: { codex: "bin/codex.js" } },
    expectedBin: "codex",
    checkedAt: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(item.updateAvailable, true);
  assert.equal(item.risk, "compatible");
  assert.match(item.reasons[0]!, /构建与引擎测试/);
});

test("主版本、命令入口或运行环境变化时必须警告", () => {
  const item = analyzeDevelopmentEngineUpdate({
    engine: "kilo",
    name: "Kilo",
    packageName: "@kilocode/cli",
    currentVersion: "1.9.0",
    metadata: { version: "2.0.0", engines: { node: ">=99" }, bin: { changed: "bin/new" } },
    expectedBin: "kilo",
    checkedAt: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(item.risk, "review");
  assert.equal(item.reasons.length, 3);
});

test("0.x 引擎跨次版本时不伪装成安全升级", () => {
  const item = analyzeDevelopmentEngineUpdate({
    engine: "pi",
    name: "Pi Agent",
    packageName: "@earendil-works/pi-coding-agent",
    currentVersion: "0.84.2",
    metadata: { version: "0.85.0", engines: { node: ">=22" }, bin: { pi: "dist/cli.js" } },
    expectedBin: "pi",
    checkedAt: "2026-08-16T00:00:00.000Z",
  });
  assert.equal(item.risk, "review");
  assert.match(item.reasons.join(" "), /未稳定接口/);
});

test("启动检查保存五个引擎状态，升级必须通过确认、构建和引擎测试", async () => {
  const root = mkdtempSync(join(tmpdir(), "clownfish-engine-update-test-"));
  try {
    writeFileSync(join(root, "package.json"), "{}", "utf8");
    writeFileSync(join(root, "package-lock.json"), "{}", "utf8");
    const commands: string[] = [];
    const service = new DevelopmentEngineUpdateService({
      registry: registry(),
      packageRoot: root,
      stateFile: join(root, "state", "updates.json"),
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      fetchMetadata: async (name) => ({
        name,
        version: name === "package-codex" ? "2.0.0" : "1.2.4",
        bin: { [name.replace("package-", "")]: "bin/run" },
      }),
      runCommand: async (file, args) => {
        commands.push(`${file} ${args.join(" ")}`);
        return { stdout: "ok", stderr: "" };
      },
    });
    const snapshot = await service.check();
    assert.equal(snapshot.items.length, 5);
    assert.equal(snapshot.items.find((item) => item.engine === "pi")?.risk, "compatible");
    assert.equal(snapshot.items.find((item) => item.engine === "codex")?.risk, "review");
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, "state", "updates.json"), "utf8")));
    await assert.rejects(() => service.upgrade("codex", "2.0.0", false), /明确确认/);
    const upgraded = await service.upgrade("pi", "1.2.4", false);
    assert.equal(upgraded.restartRequired, true);
    assert.equal(commands.length, 3);
    assert.match(commands[0]!, /install package-pi@1\.2\.4 --save-exact/);
    assert.match(commands[1]!, /run build/);
    assert.match(commands[2]!, /development-engine-plugins\.test\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("服务启动检查版本，升级接口经过显式用户操作网关", () => {
  const server = readFileSync(join(process.cwd(), "examples", "companion", "server.ts"), "utf8");
  assert.match(server, /void developmentEngineUpdates\.check\(\)/);
  assert.match(server, /url === "\/api\/development\/engine-updates"/);
  assert.match(server, /url === "\/api\/development\/engine-updates\/upgrade"/);
  assert.match(server, /name: "development_engine_upgrade"/);
  assert.match(server, /acceptRisk: body\.acceptRisk === true/);
});
