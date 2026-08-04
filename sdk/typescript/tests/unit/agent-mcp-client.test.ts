import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  AgentExtensionRegistry,
  StdioMcpClientAdapter,
  createMcpProviderFromManifest,
  type AgentExtensionManifest,
} from "../../src/agent/index.js";

const fixture = join(__dirname, "..", "fixtures", "mcp-session-server.cjs");
const appContainerFixture = join(__dirname, "..", "fixtures", "mcp-appcontainer-server.py");

function executableManifest(): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id: "session-test.mcp",
    name: "Session Test MCP",
    version: "1.0.0",
    description: "Test MCP process isolation",
    kind: "mcp",
    source: { type: "local", location: fixture },
    runtime: {
      type: "mcp",
      entry: process.execPath,
      args: [fixture],
      env: ["NEMOS_MCP_ALLOWED"],
      sandbox: {
        type: "node-permission",
        network: "unrestricted",
        filesystemRead: [dirname(fixture), join(process.cwd(), "node_modules")],
      },
      maxSessions: 4,
      sessionIdleMs: 10_000,
      requestTimeoutMs: 10_000,
    },
    permissions: ["process", "filesystem-read", "network"],
    activation: ["session"],
    tools: [{
      name: "session_info",
      description: "Return process and environment isolation details",
      effect: "read",
      tags: ["session"],
    }],
  };
}

test("official MCP stdio transport isolates processes and environment by run", async () => {
  const previousAllowed = process.env.NEMOS_MCP_ALLOWED;
  const previousSecret = process.env.NEMOS_MCP_SECRET;
  process.env.NEMOS_MCP_ALLOWED = "visible";
  process.env.NEMOS_MCP_SECRET = "hidden";
  const adapter = new StdioMcpClientAdapter({
    command: process.execPath,
    args: [fixture],
    env: ["NEMOS_MCP_ALLOWED"],
    toolPolicy: { session_info: { effect: "read", tags: ["session"] } },
    maxSessions: 4,
    sessionIdleMs: 10_000,
    requestTimeoutMs: 10_000,
  });
  const signal = new AbortController().signal;

  try {
    const tools = await adapter.listTools(signal);
    assert.deepEqual(tools.map((tool) => tool.name), ["session_info"]);

    const first = JSON.parse((await adapter.callTool("session_info", {}, { runId: "run-a", sessionId: "conversation", signal })).content);
    const second = JSON.parse((await adapter.callTool("session_info", {}, { runId: "run-a", sessionId: "conversation", signal })).content);
    const other = JSON.parse((await adapter.callTool("session_info", {}, { runId: "run-b", sessionId: "conversation", signal })).content);

    assert.equal(first.pid, second.pid);
    assert.equal(second.calls, 2);
    assert.notEqual(first.pid, other.pid);
    assert.equal(other.calls, 1);
    assert.equal(first.allowed, "visible");
    assert.equal(first.secret, null);
    assert.equal(adapter.activeRunCount, 2);
  } finally {
    await adapter.close();
    assert.equal(adapter.activeRunCount, 0);
    if (previousAllowed === undefined) delete process.env.NEMOS_MCP_ALLOWED;
    else process.env.NEMOS_MCP_ALLOWED = previousAllowed;
    if (previousSecret === undefined) delete process.env.NEMOS_MCP_SECRET;
    else process.env.NEMOS_MCP_SECRET = previousSecret;
  }
});

test("Node permission sandbox blocks undeclared files, writes, and child processes", async () => {
  const adapter = new StdioMcpClientAdapter({
    command: process.execPath,
    args: [fixture],
    sandbox: {
      type: "node-permission",
      network: "unrestricted",
      filesystemRead: [dirname(fixture), join(process.cwd(), "node_modules")],
    },
    toolPolicy: { sandbox_probe: { effect: "read", tags: ["sandbox"] } },
    requestTimeoutMs: 10_000,
  });
  try {
    const result = JSON.parse((await adapter.callTool(
      "sandbox_probe",
      {},
      { runId: "sandbox-run", sessionId: "sandbox-session", signal: new AbortController().signal },
    )).content);
    assert.deepEqual(result, {
      allowedRead: true,
      deniedRead: true,
      deniedWrite: true,
      deniedChildProcess: true,
    });
  } finally {
    await adapter.close();
  }
});

test("network-denied sandbox uses the verified dedicated runtime or fails closed", async () => {
  const sandboxNodeCommand = process.env.NEMOS_TEST_SANDBOX_NODE;
  const sandboxNodeVersion = process.env.NEMOS_TEST_SANDBOX_NODE_VERSION;
  const options = {
    command: process.execPath,
    args: [fixture],
    sandbox: {
      type: "node-permission" as const,
      network: "deny" as const,
      filesystemRead: [dirname(fixture), join(process.cwd(), "node_modules")],
    },
    toolPolicy: { network_probe: { effect: "read" as const, tags: ["sandbox"] } },
    requestTimeoutMs: 10_000,
    sandboxNodeCommand,
    sandboxNodeVersion,
  };
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 25 && !sandboxNodeCommand) {
    assert.throws(
      () => new StdioMcpClientAdapter(options),
      /requires Node 25 or newer/,
    );
    return;
  }

  const adapter = new StdioMcpClientAdapter(options);
  try {
    const result = JSON.parse((await adapter.callTool(
      "network_probe",
      {},
      { runId: "network-run", sessionId: "network-session", signal: new AbortController().signal },
    )).content);
    assert.deepEqual(result, { denied: true, code: "ERR_ACCESS_DENIED" });
  } finally {
    await adapter.close();
  }
});

test("dedicated MCP runtime version metadata must match the executable", () => {
  assert.throws(
    () => new StdioMcpClientAdapter({
      command: process.execPath,
      args: [fixture],
      sandbox: {
        type: "node-permission",
        network: "deny",
        filesystemRead: [dirname(fixture), join(process.cwd(), "node_modules")],
      },
      sandboxNodeCommand: process.execPath,
      sandboxNodeVersion: "99.0.0",
    }),
    /version mismatch/,
  );
});
test("Windows AppContainer isolates Python MCP files, network, and child processes", async () => {
  const host = process.env.NEMOS_TEST_WINDOWS_SANDBOX_HOST;
  const python = process.env.NEMOS_TEST_WINDOWS_SANDBOX_PYTHON;
  const pythonVersion = process.env.NEMOS_TEST_WINDOWS_SANDBOX_PYTHON_VERSION;
  const root = mkdtempSync(join(tmpdir(), "nemos-appcontainer-test-"));
  const allowedRead = join(root, "allowed-read.txt");
  const deniedRead = join(root, "denied-read.txt");
  const allowedWriteDir = join(root, "allowed-write");
  const deniedWriteDir = join(root, "denied-write");
  writeFileSync(allowedRead, "visible");
  writeFileSync(deniedRead, "hidden");
  mkdirSync(allowedWriteDir);
  mkdirSync(deniedWriteDir);

  const options = {
    command: "nemos-python",
    args: [appContainerFixture],
    cwd: process.cwd(),
    sandbox: {
      type: "windows-appcontainer" as const,
      network: "deny" as const,
      filesystemRead: [dirname(appContainerFixture), allowedRead],
      filesystemWrite: [allowedWriteDir],
    },
    toolPolicy: { sandbox_probe: { effect: "read" as const, tags: ["sandbox"] } },
    requestTimeoutMs: 15_000,
    sandboxHostCommand: host,
    sandboxPythonCommand: python,
    sandboxPythonVersion: pythonVersion,
  };

  if (process.platform !== "win32") {
    assert.throws(() => new StdioMcpClientAdapter(options), /only available on Windows/);
    rmSync(root, { recursive: true, force: true });
    return;
  }
  if (!host || !python || !pythonVersion) {
    assert.throws(() => new StdioMcpClientAdapter(options), /sandbox host.*not configured/);
    rmSync(root, { recursive: true, force: true });
    return;
  }

  const adapter = new StdioMcpClientAdapter(options);
  const loopbackServer = createServer((socket) => socket.end());
  await new Promise<void>((resolveListen, rejectListen) => {
    loopbackServer.once("error", rejectListen);
    loopbackServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = loopbackServer.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = JSON.parse((await adapter.callTool(
      "sandbox_probe",
      {
        allowedRead,
        deniedRead,
        allowedWriteDir,
        deniedWriteDir,
        localProbePort: address.port,
      },
      { runId: "appcontainer-run", sessionId: "appcontainer-session", signal: new AbortController().signal },
    )).content);
    assert.deepEqual(result, {
      allowed_read: true,
      denied_read: true,
      allowed_write: true,
      denied_write: true,
      denied_network: true,
      denied_loopback: true,
      denied_child_process: true,
    });
  } finally {
    await adapter.close();
    await new Promise<void>((resolveClose) => loopbackServer.close(() => resolveClose()));
    rmSync(root, { recursive: true, force: true });
  }
});
test("credential bindings give MCP children only a scoped proxy lease", async () => {
  const previousSecret = process.env.NEMOS_MCP_SECRET;
  process.env.NEMOS_MCP_SECRET = "upstream-secret";
  const adapter = new StdioMcpClientAdapter({
    command: process.execPath,
    args: [fixture],
    credentials: [{
      id: "upstream",
      sourceEnv: "NEMOS_MCP_SECRET",
      allowedUrlPrefixes: ["https://api.example.com/v1/"],
    }],
    toolPolicy: { session_info: { effect: "read", tags: ["session"] } },
    requestTimeoutMs: 10_000,
  });
  try {
    const result = JSON.parse((await adapter.callTool(
      "session_info",
      {},
      { runId: "credential-session", sessionId: "credential-session", signal: new AbortController().signal },
    )).content);
    assert.equal(result.secret, null);
    assert.equal(result.credentialProxy, true);
  } finally {
    await adapter.close();
    if (previousSecret === undefined) delete process.env.NEMOS_MCP_SECRET;
    else process.env.NEMOS_MCP_SECRET = previousSecret;
  }
});

test("manifest-backed MCP provider is attached and callable through the extension registry", async () => {
  const manifest = executableManifest();
  const provider = createMcpProviderFromManifest(manifest);
  assert.ok(provider);

  const registry = new AgentExtensionRegistry();
  registry.install(manifest, provider);
  assert.equal(registry.get(manifest.id)?.providerAttached, true);

  const tools = await registry.toolsForRequest("session status");
  assert.equal(tools.length, 1);
  const result = await tools[0]!.execute(
    {},
    { runId: "registry-session", sessionId: "registry-session", signal: new AbortController().signal },
  );
  assert.equal(typeof JSON.parse(result.content).pid, "number");
  registry.setEnabled(manifest.id, false);
  await assert.rejects(
    tools[0]!.execute({}, { runId: "registry-session", sessionId: "registry-session", signal: new AbortController().signal }),
    /no longer active/,
  );
});
