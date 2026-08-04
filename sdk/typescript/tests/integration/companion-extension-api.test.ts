import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import type { AgentExtensionManifest } from "../../src/agent/index.js";

const root = resolve(__dirname, "..", "..");
const serverEntry = join(root, "examples", "companion", "server.ts");
const tsxEntry = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const fixture = join(root, "tests", "fixtures", "mcp-session-server.cjs");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

function startCompanion(port: number, home: string): {
  child: ChildProcessWithoutNullStreams;
  logs: () => string;
} {
  const child = spawn(process.execPath, [tsxEntry, serverEntry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NEMOS_COMPANION_HOME: home,
      ZHIPU_API_KEY: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, logs: () => output };
}

async function stopCompanion(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
}

async function waitForCompanion(baseUrl: string, child: ChildProcessWithoutNullStreams, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error("Companion exited during startup:\n" + logs());
    }
    try {
      const response = await fetch(baseUrl + "/api/runtime");
      if (response.ok) return;
    } catch {
      // Startup may still be initializing the local database.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Companion startup timed out:\n" + logs());
}

async function request(
  baseUrl: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const response = await fetch(baseUrl + path, body === undefined
    ? undefined
    : {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? JSON.parse(text) : {},
  };
}

function skillManifest(version = "1.0.0"): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "integration.skill",
    name: "Integration Skill",
    version,
    description: "Validate the Companion extension lifecycle",
    kind: "skill",
    source: { type: "local", location: join(root, "tests", "fixtures", "SKILL.md") },
    runtime: { type: "skill-markdown" },
    permissions: [],
    activation: ["integration"],
    tools: [],
  };
}

function executableManifest(): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "integration.mcp",
    name: "Integration MCP",
    version: "1.0.0",
    description: "Validate executable extension confirmations",
    kind: "mcp",
    source: { type: "local", location: fixture },
    runtime: {
      type: "mcp",
      entry: process.execPath,
      args: [fixture],
      cwd: dirname(fixture),
    },
    permissions: ["process"],
    activation: ["session"],
    tools: [{
      name: "session_info",
      description: "Return process isolation details",
      effect: "read",
      tags: ["session"],
    }],
  };
}

test("Companion extension API closes the install, trust, and provider lifecycle", { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "nemos-companion-extension-api-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const { child, logs } = startCompanion(port, home);

  try {
    await waitForCompanion(baseUrl, child, logs);

    const invalid = await request(baseUrl, "/api/agent/extension/validate", { manifest: {} });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error, "扩展清单校验失败");
    assert(Array.isArray(invalid.data.details));
    assert(invalid.data.details.length > 0);

    const safe = skillManifest();
    const validation = await request(baseUrl, "/api/agent/extension/validate", { manifest: safe });
    assert.equal(validation.status, 200);
    assert.equal(validation.data.validation.installed, false);
    assert.equal(validation.data.validation.executionSecurity, "not-executable");

    const installed = await request(baseUrl, "/api/agent/extension/install", { manifest: safe });
    assert.equal(installed.status, 200);
    assert.equal(installed.data.extension.enabled, true);
    assert.equal(installed.data.extension.providerAttached, false);

    const upgraded = await request(baseUrl, "/api/agent/extension/upgrade", {
      manifest: skillManifest("1.1.0"),
    });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.data.extension.manifest.version, "1.1.0");

    const disabledSkill = await request(baseUrl, "/api/agent/extension/enabled", {
      id: safe.id,
      enabled: false,
    });
    assert.equal(disabledSkill.status, 200);
    assert.equal(disabledSkill.data.extension.enabled, false);

    const removedSkill = await request(baseUrl, "/api/agent/extension/uninstall", { id: safe.id });
    assert.equal(removedSkill.status, 200);
    assert.equal(removedSkill.data.extension.manifest.id, safe.id);

    const executable = executableManifest();
    const firstGate = await request(baseUrl, "/api/agent/extension/install", { manifest: executable });
    assert.equal(firstGate.status, 409);
    assert.equal(firstGate.data.requiresConfirmation, true);

    const secondGate = await request(baseUrl, "/api/agent/extension/install", {
      manifest: executable,
      confirmExecutable: true,
    });
    assert.equal(secondGate.status, 409);
    assert.equal(secondGate.data.requiresUnsandboxedConfirmation, true);

    const trustedInstall = await request(baseUrl, "/api/agent/extension/install", {
      manifest: executable,
      confirmExecutable: true,
      confirmUnsandboxed: true,
    });
    assert.equal(trustedInstall.status, 200);
    assert.equal(trustedInstall.data.extension.executionSecurity, "unsandboxed-confirmed");
    assert.equal(trustedInstall.data.extension.providerAttached, true);

    const disabled = await request(baseUrl, "/api/agent/extension/enabled", {
      id: executable.id,
      enabled: false,
    });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.data.extension.enabled, false);
    assert.equal(disabled.data.extension.providerAttached, false);

    const reenabled = await request(baseUrl, "/api/agent/extension/enabled", {
      id: executable.id,
      enabled: true,
    });
    assert.equal(reenabled.status, 200);
    assert.equal(reenabled.data.extension.enabled, true);
    assert.equal(reenabled.data.extension.providerAttached, true);

    const listed = await request(baseUrl, "/api/agent/extensions");
    assert.equal(listed.status, 200);
    const record = listed.data.extensions.find((item: any) => item.manifest.id === executable.id);
    assert(record);
    assert.equal(record.runtimeError, null);
    assert.equal(record.providerAttached, true);

    const removed = await request(baseUrl, "/api/agent/extension/uninstall", { id: executable.id });
    assert.equal(removed.status, 200);
    const finalList = await request(baseUrl, "/api/agent/extensions");
    assert.equal(finalList.data.extensions.some((item: any) => item.manifest.id === executable.id), false);
  } finally {
    await stopCompanion(child);
    rmSync(home, { recursive: true, force: true });
  }
});
