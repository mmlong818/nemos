import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import type { AgentExtensionManifest } from "../../src/agent/index.js";
import { CompanionTestLaunchError, launchCompanionForTest } from "../fixtures/companion-test-launch.js";

const root = resolve(__dirname, "..", "..");
const fixture = join(root, "tests", "fixtures", "mcp-session-server.cjs");

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
  let app: Awaited<ReturnType<typeof launchCompanionForTest>> | undefined;
  let failed = false;
  let cleanupIncomplete = false;

  try {
    app = await launchCompanionForTest({ home, timeoutMs: 30_000 });
    const { base: baseUrl } = app;

    const readiness = await request(baseUrl, "/api/platform/readiness");
    assert.equal(readiness.status, 200);
    assert.deepEqual(readiness.data.connectors.map((item: any) => item.id), ["files", "github", "browser", "email", "calendar", "enterprise-docs"]);
    assert.equal(readiness.data.connectors.find((item: any) => item.id === "files")?.state, "ready");
    const filesConnection = await request(baseUrl, "/api/platform/connector/test", { id: "files" });
    assert.equal(filesConnection.status, 200);
    assert.equal(filesConnection.data.connector.provider, "built-in");

    const invalid = await request(baseUrl, "/api/agent/extension/validate", { manifest: {} });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.error, "请求无法完成，请检查输入后重试。");
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

    const rolledBack = await request(baseUrl, "/api/agent/extension/rollback", { id: safe.id });
    assert.equal(rolledBack.status, 200);
    assert.equal(rolledBack.data.extension.manifest.version, "1.0.0");

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
  } catch (error) {
    failed = true;
    cleanupIncomplete = error instanceof CompanionTestLaunchError && error.cleanupIncomplete;
    throw error;
  } finally {
    try {
      await app?.stop();
    } catch (error) {
      cleanupIncomplete = true;
      if (!failed) throw error;
    }
    try {
      if (!cleanupIncomplete) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    } catch {
      // Windows may keep a just-stopped extension child handle alive until this test process exits.
    }
  }
});
