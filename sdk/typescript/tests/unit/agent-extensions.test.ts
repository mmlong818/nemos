import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AgentExtensionRegistry,
  createMcpExtensionProvider,
  validateAgentExtensionManifest,
  type AgentExtensionManifest,
} from "../../src/agent/index.js";

function manifest(version = "1.0.0"): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "weather.mcp",
    name: "Weather MCP",
    version,
    description: "Current weather tools",
    kind: "mcp",
    source: { type: "local", location: "stdio:weather-server" },
    runtime: { type: "mcp" },
    permissions: ["network"],
    activation: ["天气", "weather"],
    tools: [{ name: "weather_lookup", description: "Look up weather", effect: "read", tags: ["天气", "weather"] }],
  };
}

test("validates extension permissions and machine-readable manifests", () => {
  assert.deepEqual(validateAgentExtensionManifest(manifest()), []);
  const invalid = manifest();
  invalid.tools = [{ name: "publish", description: "publish", effect: "write" }];
  assert.match(validateAgentExtensionManifest(invalid).join(" "), /write permission/);

  const executable = manifest();
  executable.runtime = { type: "mcp", entry: process.execPath };
  assert.match(validateAgentExtensionManifest(executable).join(" "), /process permission/);
  executable.permissions.push("process");
  assert.deepEqual(validateAgentExtensionManifest(executable), []);
  executable.runtime.args = ["--api-key", "do-not-store-this"];
  assert.match(validateAgentExtensionManifest(executable).join(" "), /must not contain credential flags/);

  const proxiedCredential = manifest();
  proxiedCredential.runtime = {
    type: "mcp",
    entry: process.execPath,
    env: ["ZHIPU_API_KEY"],
  };
  proxiedCredential.permissions.push("process");
  assert.match(validateAgentExtensionManifest(proxiedCredential).join(" "), /cannot expose credential-like variables/);
  proxiedCredential.runtime.env = [];
  proxiedCredential.runtime.credentials = [{
    id: "zhipu",
    sourceEnv: "ZHIPU_API_KEY",
    allowedUrlPrefixes: ["https://open.bigmodel.cn/api/"],
    allowedMethods: ["POST"],
    header: "Authorization",
    prefix: "Bearer ",
  }];
  assert.deepEqual(validateAgentExtensionManifest(proxiedCredential), []);

  const invalidSource = manifest();
  invalidSource.source = { type: "url", location: "file:///tmp/manifest.json" };
  invalidSource.runtime = { type: "http" };
  invalidSource.permissions = ["network", "network"];
  assert.match(
    validateAgentExtensionManifest(invalidSource).join(" "),
    /must use http or https.*require the mcp runtime.*duplicates/,
  );
});

test("validates Node MCP sandbox scope and bypass controls", () => {
  const sandboxed = manifest();
  sandboxed.runtime = {
    type: "mcp",
    entry: process.execPath,
    args: ["server.cjs"],
    sandbox: {
      type: "node-permission",
      network: "unrestricted",
      filesystemRead: ["server.cjs", "node_modules"],
    },
  };
  sandboxed.permissions.push("process", "filesystem-read");
  assert.deepEqual(validateAgentExtensionManifest(sandboxed), []);

  sandboxed.runtime.sandbox!.network = "deny";
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /deny conflicts with the network permission/);
  sandboxed.permissions = sandboxed.permissions.filter((permission) => permission !== "network");
  assert.deepEqual(validateAgentExtensionManifest(sandboxed), []);
  sandboxed.runtime.sandbox!.network = "unrestricted";
  sandboxed.permissions.push("network");

  sandboxed.runtime.env = ["NODE_OPTIONS"];
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /cannot inherit NODE_OPTIONS/);
  sandboxed.runtime.env = [];
  sandboxed.runtime.entry = "python";
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /direct node executable/);
  sandboxed.runtime.entry = process.execPath;
  sandboxed.runtime.args = ["--eval", "malicious()"];
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /script as the first runtime argument/);
});

test("validates Windows AppContainer MCP scope and unsupported credential paths", () => {
  const sandboxed = manifest();
  sandboxed.runtime = {
    type: "mcp",
    entry: "nemos-python",
    args: ["server.py"],
    sandbox: {
      type: "windows-appcontainer",
      network: "deny",
      filesystemRead: ["server.py"],
      filesystemWrite: ["output"],
    },
  };
  sandboxed.permissions = ["process", "filesystem-read", "filesystem-write"];
  assert.deepEqual(validateAgentExtensionManifest(sandboxed), []);

  sandboxed.runtime.sandbox!.network = "unrestricted";
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /requires the network permission/);
  sandboxed.permissions.push("network");
  assert.deepEqual(validateAgentExtensionManifest(sandboxed), []);

  sandboxed.runtime.credentials = [{
    id: "zhipu",
    sourceEnv: "ZHIPU_API_KEY",
    allowedUrlPrefixes: ["https://open.bigmodel.cn/api/"],
  }];
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /cannot use the loopback HTTP credential proxy/);
  sandboxed.runtime.credentials = [];
  sandboxed.runtime.entry = "server.cmd";
  assert.match(validateAgentExtensionManifest(sandboxed).join(" "), /direct executable/);
});
test("blocks unapproved executable extensions and persists explicit unsafe approval", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-extension-security-"));
  const approvedFile = join(dir, "approved.json");
  const legacyFile = join(dir, "legacy.json");
  const executable = manifest();
  executable.runtime = { type: "mcp", entry: process.execPath, args: ["server.cjs"] };
  executable.permissions.push("process");
  let rejectedProvidersClosed = 0;
  const provider = () => ({
    discover: async () => [],
    loadTool: async () => { throw new Error("not used"); },
    close: () => { rejectedProvidersClosed++; },
  });

  try {
    const registry = new AgentExtensionRegistry(approvedFile);
    assert.throws(
      () => registry.install(executable, provider()),
      /allowUnsandboxed approval/,
    );
    assert.equal(rejectedProvidersClosed, 1);
    const installed = registry.install(executable, undefined, { allowUnsandboxed: true });
    assert.equal(installed.executionSecurity, "unsandboxed-confirmed");
    assert.equal(new AgentExtensionRegistry(approvedFile).get(executable.id)?.executionSecurity, "unsandboxed-confirmed");

    const now = new Date().toISOString();
    writeFileSync(legacyFile, JSON.stringify({
      version: 1,
      extensions: [{
        manifest: executable,
        enabled: true,
        installedAt: now,
        updatedAt: now,
        audit: [],
      }],
    }));
    const legacy = new AgentExtensionRegistry(legacyFile);
    assert.equal(legacy.get(executable.id)?.executionSecurity, "blocked");
    assert.throws(
      () => legacy.attachProvider(executable.id, provider()),
      /execution is blocked/,
    );
    assert.equal(rejectedProvidersClosed, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("installs, disables, upgrades, persists, and audits extensions without changing core code", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-extensions-"));
  const file = join(dir, "extensions.json");
  try {
    const registry = new AgentExtensionRegistry(file);
    registry.install(manifest());
    assert.equal(registry.get("weather.mcp")?.enabled, true);
    registry.setEnabled("weather.mcp", false);
    registry.upgrade(manifest("1.1.0"));
    assert.throws(() => registry.upgrade(manifest("1.0.0")), /must increase the version/);

    const reloaded = new AgentExtensionRegistry(file);
    const record = reloaded.get("weather.mcp");
    assert.equal(record?.enabled, false);
    assert.equal(record?.manifest.version, "1.1.0");
    assert.deepEqual(record?.audit.map((item) => item.action), ["install", "disable", "upgrade"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("requires renewed approval when an upgrade expands permissions, tools, or models", () => {
  const registry = new AgentExtensionRegistry();
  const initial = manifest();
  initial.models = ["daily-model"];
  registry.install(initial);
  registry.assertModelAccess(initial.id, "daily-model");
  assert.throws(() => registry.assertModelAccess(initial.id, "flagship-model"), /not allowed/);

  const expanded = manifest("1.1.0");
  expanded.models = ["daily-model", "flagship-model"];
  expanded.permissions.push("external-write");
  expanded.tools.push({ name: "weather_publish", description: "Publish weather", effect: "write" });

  assert.throws(() => registry.upgrade(expanded), /requires explicit approval/);
  const upgraded = registry.upgrade(expanded, undefined, { approvePermissionExpansion: true });
  assert.deepEqual(upgraded.manifest.models, ["daily-model", "flagship-model"]);
  registry.assertModelAccess(initial.id, "flagship-model");
});
test("disabled executable extensions release and recreate their provider lifecycle", () => {
  const executable = manifest();
  executable.runtime = { type: "mcp", entry: process.execPath, args: ["server.cjs"] };
  executable.permissions.push("process");
  let closed = 0;
  const provider = () => ({
    discover: async () => [],
    loadTool: async () => { throw new Error("not used"); },
    close: () => { closed++; },
  });
  const registry = new AgentExtensionRegistry();

  const installed = registry.install(executable, provider(), { allowUnsandboxed: true });
  assert.equal(installed.providerAttached, true);
  const disabled = registry.setEnabled(executable.id, false);
  assert.equal(disabled.providerAttached, false);
  assert.equal(closed, 1);
  assert.throws(
    () => registry.setEnabled(executable.id, true),
    /requires a provider/,
  );

  const enabled = registry.setEnabled(executable.id, true, provider());
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.providerAttached, true);
  registry.setEnabled(executable.id, false);
  assert.equal(closed, 2);

  const upgraded = registry.upgrade({ ...executable, version: "1.1.0" }, provider(), { allowUnsandboxed: true });
  assert.equal(upgraded.enabled, false);
  assert.equal(upgraded.providerAttached, false);
  assert.equal(closed, 3);
  assert.throws(
    () => registry.upgrade({ ...executable, version: "1.1.0" }, provider(), { allowUnsandboxed: true }),
    /must increase the version/,
  );
  assert.equal(closed, 4);
});
test("discovers and loads MCP tools only after an activation cue matches", async () => {
  let discoveries = 0;
  let calls = 0;
  const registry = new AgentExtensionRegistry();
  registry.install(manifest(), createMcpExtensionProvider("weather.mcp", {
    listTools: async () => {
      discoveries++;
      return [{
        name: "weather_lookup",
        description: "Look up weather",
        inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        effect: "read",
        tags: ["天气", "weather"],
      }];
    },
    callTool: async (_name, input) => {
      calls++;
      return { content: `${String(input.city)}: sunny` };
    },
  }));

  assert.deepEqual(await registry.toolsForRequest("你好"), []);
  assert.equal(discoveries, 0);
  const tools = await registry.toolsForRequest("上海天气");
  assert.equal(discoveries, 1);
  assert.equal(tools[0]?.definition.name, "weather_lookup");
  const result = await tools[0]!.execute(
    { city: "上海" },
    { runId: "session-a", sessionId: "session-a", signal: new AbortController().signal },
  );
  assert.equal(result.content, "上海: sunny");
  assert.equal(calls, 1);
  assert.equal(registry.get("weather.mcp")?.audit.at(-1)?.action, "tool-call");
});
