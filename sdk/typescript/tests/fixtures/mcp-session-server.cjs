const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { connect } = require("node:net");

const { McpServer } = require("@modelcontextprotocol/server");
const { serveStdio } = require("@modelcontextprotocol/server/stdio");

serveStdio(() => {
  const server = new McpServer({ name: "nemos-test-mcp", version: "1.0.0" });
  let calls = 0;
  server.registerTool("session_info", {
    description: "Return process and environment isolation details",
    inputSchema: {},
  }, async () => {
    calls++;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          pid: process.pid,
          calls,
          allowed: process.env.NEMOS_MCP_ALLOWED ?? null,
          secret: process.env.NEMOS_MCP_SECRET ?? null,
          credentialProxy: Boolean(process.env.NEMOS_CREDENTIAL_PROXY_URL && process.env.NEMOS_CREDENTIAL_PROXY_TOKEN),
        }),
      }],
    };
  });
  server.registerTool("network_probe", {
    description: "Probe direct network access",
    inputSchema: {},
  }, async () => {
    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (code) => {
        if (settled) return;
        settled = true;
        resolve({ denied: code === "ERR_ACCESS_DENIED", code: code || null });
      };
      try {
        const socket = connect({ host: "127.0.0.1", port: 9 });
        socket.once("error", (error) => finish(error?.code));
        socket.once("connect", () => {
          socket.destroy();
          finish("CONNECTED");
        });
        setTimeout(() => {
          socket.destroy();
          finish("TIMEOUT");
        }, 1_000).unref?.();
      } catch (error) {
        finish(error?.code);
      }
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  });
  // 探测宿主分配的数据目录：路径由 NEMOS_EXTENSION_DATA_DIR 给出，
  // 且必须在沙箱里被放行读写——只给路径不放行等于没给。
  server.registerTool("data_dir_probe", {
    description: "Probe the host-provisioned extension data directory",
    inputSchema: {},
  }, async () => {
    const dir = process.env.NEMOS_EXTENSION_DATA_DIR || "";
    const probe = { hasEnv: Boolean(dir), wrote: false, readBack: "", deniedElsewhere: false };
    if (dir) {
      const target = join(dir, "probe.txt");
      try {
        writeFileSync(target, "from-extension");
        probe.wrote = true;
        probe.readBack = readFileSync(target, "utf8");
      } catch (error) {
        probe.readBack = "ERR:" + (error && error.code);
      }
    }
    try {
      writeFileSync(join(process.cwd(), "outside-data-dir.tmp"), "blocked");
    } catch (error) {
      probe.deniedElsewhere = error?.code === "ERR_ACCESS_DENIED";
    }
    return { content: [{ type: "text", text: JSON.stringify(probe) }] };
  });
  server.registerTool("sandbox_probe", {
    description: "Probe Node permission sandbox boundaries",
    inputSchema: {},
  }, async () => {
    const probe = {
      allowedRead: false,
      deniedRead: false,
      deniedWrite: false,
      deniedChildProcess: false,
    };
    try {
      readFileSync(__filename);
      probe.allowedRead = true;
    } catch {}
    try {
      readFileSync(join(process.cwd(), "package.json"));
    } catch (error) {
      probe.deniedRead = error?.code === "ERR_ACCESS_DENIED";
    }
    try {
      writeFileSync(join(process.cwd(), "sandbox-probe.tmp"), "blocked");
    } catch (error) {
      probe.deniedWrite = error?.code === "ERR_ACCESS_DENIED";
    }
    try {
      const result = spawnSync(process.execPath, ["--version"]);
      probe.deniedChildProcess = result.error?.code === "ERR_ACCESS_DENIED";
    } catch (error) {
      probe.deniedChildProcess = error?.code === "ERR_ACCESS_DENIED";
    }
    return {
      content: [{ type: "text", text: JSON.stringify(probe) }],
    };
  });
  return server;
});
