import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readServerRouteSurface } from "../fixtures/server-route-surface.js";

import {
  AgentExtensionStorageError,
  FileAgentExtensionStorage,
} from "../../src/agent/extension-storage.js";

// 同步与异步两种用法都要支持：异步测试体没跑完就删目录，会得到一串 ENOENT 假故障。
function withDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "nemos-ext-storage-"));
  const cleanup = (): void => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  let result: T;
  try {
    result = run(dir);
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result instanceof Promise) return result.finally(cleanup) as T;
  cleanup();
  return result;
}

test("按扩展隔离：一个扩展看不到也改不了另一个的数据", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(dir);
    const a = storage.forExtension("ext.alpha");
    const b = storage.forExtension("ext.beta");
    a.set("shared", { from: "alpha" });
    b.set("shared", { from: "beta" });
    assert.deepEqual(a.get("shared"), { from: "alpha" });
    assert.deepEqual(b.get("shared"), { from: "beta" });
    assert.deepEqual(a.keys(), ["shared"]);
    b.delete("shared");
    assert.deepEqual(a.get("shared"), { from: "alpha" }, "删别人的键不该影响自己");
    assert.equal(b.get("shared"), undefined);
  });
});

test("跨实例持久化，并且原子写不留临时文件", () => {
  withDir((dir) => {
    new FileAgentExtensionStorage(dir).forExtension("ext.alpha").set("k", [1, 2, 3]);
    const reopened = new FileAgentExtensionStorage(dir).forExtension("ext.alpha");
    assert.deepEqual(reopened.get("k"), [1, 2, 3]);
    assert.deepEqual(readdirSync(join(dir, "kv")).filter((f) => f.endsWith(".tmp")), []);
  });
});

test("配额在写入之前判定：超了整笔拒绝，原有数据不动", () => {
  withDir((dir) => {
    const store = new FileAgentExtensionStorage(dir, { maxBytesPerExtension: 4096 }).forExtension("ext.alpha");
    store.set("keep", "safe");
    assert.throws(
      () => store.set("huge", "x".repeat(8000)),
      (error: unknown) => error instanceof AgentExtensionStorageError && error.reason === "quota-bytes",
    );
    assert.equal(store.get("keep"), "safe", "被拒绝的写入不能破坏已有数据");
    assert.equal(store.get("huge"), undefined);
    assert.ok(store.usage().bytes < 4096);
  });
});

test("键数量有上限；覆盖已有键不算新增", () => {
  withDir((dir) => {
    const store = new FileAgentExtensionStorage(dir, { maxKeys: 2 }).forExtension("ext.alpha");
    store.set("a", 1);
    store.set("b", 2);
    store.set("a", 11);
    assert.equal(store.get("a"), 11, "覆盖不该被配额挡住");
    assert.throws(
      () => store.set("c", 3),
      (error: unknown) => error instanceof AgentExtensionStorageError && error.reason === "quota-keys",
    );
    assert.deepEqual(store.keys(), ["a", "b"]);
  });
});

test("单个值也有上限，且不合规的键与值都明确报错", () => {
  withDir((dir) => {
    const store = new FileAgentExtensionStorage(dir, { maxValueBytes: 1024 }).forExtension("ext.alpha");
    assert.throws(() => store.set("big", "y".repeat(2000)), /单个值/);
    for (const bad of ["", "../escape", "有中文", "a".repeat(201), "with space"]) {
      assert.throws(
        () => store.set(bad, 1),
        (error: unknown) => error instanceof AgentExtensionStorageError && error.reason === "invalid-key",
        `${JSON.stringify(bad)} 应被拒绝`,
      );
    }
    assert.throws(
      () => store.set("fn", () => 1),
      (error: unknown) => error instanceof AgentExtensionStorageError && error.reason === "invalid-value",
    );
  });
});

test("扩展标识不合规直接拒绝，挡住拼路径", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(dir);
    for (const bad of ["../evil", "UPPER", "a/b", ""]) {
      assert.throws(() => storage.forExtension(bad), /扩展标识不合规/, `${JSON.stringify(bad)} 应被拒绝`);
    }
  });
});

test("卸载时清数据：留着等于没卸干净", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(dir);
    storage.forExtension("ext.alpha").set("k", "v");
    storage.forExtension("ext.beta").set("k", "v");
    assert.ok(existsSync(join(dir, "kv", "ext.alpha.json")));
    const files = storage.directoryFor("ext.alpha");
    writeFileSync(join(files, "blob.bin"), "payload");
    storage.clear("ext.alpha");
    assert.equal(existsSync(join(dir, "kv", "ext.alpha.json")), false);
    assert.equal(existsSync(files), false, "子进程数据目录也要清掉");
    assert.equal(storage.forExtension("ext.alpha").get("k"), undefined);
    assert.equal(storage.forExtension("ext.beta").get("k"), "v", "只清目标扩展");
  });
});

test("数据文件损坏按空处理，不阻塞扩展启动", () => {
  withDir((dir) => {
    mkdirSync(join(dir, "kv"), { recursive: true });
    writeFileSync(join(dir, "kv", "ext.alpha.json"), "{ 这不是 JSON");
    const store = new FileAgentExtensionStorage(dir).forExtension("ext.alpha");
    assert.deepEqual(store.keys(), []);
    store.set("k", "v");
    assert.equal(store.get("k"), "v", "写入应重建有效文件");
  });
});

test("usage 报告真实占用与上限", () => {
  withDir((dir) => {
    const store = new FileAgentExtensionStorage(dir, { maxBytesPerExtension: 8192, maxKeys: 5 }).forExtension("ext.alpha");
    assert.deepEqual(store.usage(), {
      bytes: 2, keys: 0, maxBytes: 8192, maxKeys: 5,
      files: { bytes: 0, count: 0, truncated: false },
    });
    store.set("k", "v");
    const usage = store.usage();
    assert.equal(usage.keys, 1);
    assert.ok(usage.bytes > 2);
  });
});

// —— 权限闸门与注册表接线 ——
// 存储必须是声明了才有。安装审查里那条 storage 权限就是这里的闸门，
// 不声明却拿得到，等于审查没有意义。

import {
  AgentExtensionRegistry,
  validateAgentExtensionManifest,
  type AgentExtensionManifest,
  type AgentExtensionProvider,
  type AgentTool,
  type AgentToolContext,
} from "../../src/agent/index.js";

function moduleManifest(id: string, permissions: AgentExtensionManifest["permissions"]): AgentExtensionManifest {
  return {
    schemaVersion: 1,
    id,
    name: "Storage probe",
    version: "1.0.0",
    description: "probe",
    kind: "agent-app",
    source: { type: "builtin", location: "builtin:" + id },
    runtime: { type: "module", entry: "builtin:" + id },
    permissions,
    activation: ["probe"],
    tools: [{ name: "probe", description: "probe", effect: "read", tags: ["probe"] }],
  };
}

/** 只把拿到的 context 记下来，用于断言宿主注入了什么。 */
function probeProvider(seen: AgentToolContext[], extensionId = "probe"): AgentExtensionProvider {
  const tool: AgentTool = {
    definition: { name: "probe", description: "probe", inputSchema: { type: "object" }, effect: "read" },
    execute: async (_input, context) => {
      seen.push(context);
      return { content: "ok" };
    },
  };
  return {
    discover: async () => [{ extensionId, name: "probe", description: "probe", effect: "read", tags: ["probe"] }],
    loadTool: async () => tool,
    close: async () => {},
  };
}

test("storage 是合法权限，声明了才拿得到句柄", async () => {
  assert.deepEqual(validateAgentExtensionManifest(moduleManifest("probe.yes", ["storage"])), []);
  await withDir(async (dir) => {
    const storage = new FileAgentExtensionStorage(join(dir, "data"));
    const seen: AgentToolContext[] = [];
    const registry = new AgentExtensionRegistry(join(dir, "extensions.json"), { storage });
    const context: AgentToolContext = { runId: "r1", sessionId: "s1", signal: new AbortController().signal };

    for (const [id, permissions] of [["probe.yes", ["storage"]], ["probe.no", ["memory-read"]]] as const) {
      registry.install(moduleManifest(id, [...permissions]), probeProvider(seen, id));
    }
    const before = seen.length;
    const yes = await registry.toolsForRequest("probe");
    for (const tool of yes) await tool.execute({}, context);
    assert.ok(seen.length > before, "探针工具应当被执行到");
    const withStorage = seen.filter((item) => item.storage);
    assert.equal(withStorage.length, 1, "只有声明了 storage 的那个扩展拿到句柄");

    // 拿到句柄的那个写进去，另一个即便自己去要也读不到它的数据。
    withStorage[0]!.storage!.set("secret", "alpha-only");
    assert.equal(storage.forExtension("probe.no").get("secret"), undefined);
  });
});

test("卸载扩展连同它的数据一起清掉", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(join(dir, "data"));
    const registry = new AgentExtensionRegistry(join(dir, "extensions.json"), { storage });
    registry.install(moduleManifest("probe.gone", ["storage"]), probeProvider([], "probe.gone"));
    storage.forExtension("probe.gone").set("k", "v");
    assert.equal(storage.forExtension("probe.gone").get("k"), "v");
    registry.uninstall("probe.gone");
    assert.equal(storage.forExtension("probe.gone").get("k"), undefined, "同 id 重装不该读到上一个扩展的数据");
  });
});

test("没配置托管存储时谁都没有句柄，而不是退化成共享一份", async () => {
  await withDir(async (dir) => {
    const seen: AgentToolContext[] = [];
    const registry = new AgentExtensionRegistry(join(dir, "extensions.json"));
    registry.install(moduleManifest("probe.yes", ["storage"]), probeProvider(seen, "probe.yes"));
    const tools = await registry.toolsForRequest("probe");
    for (const tool of tools) {
      await tool.execute({}, { runId: "r1", sessionId: "s1", signal: new AbortController().signal });
    }
    assert.ok(seen.length > 0);
    assert.deepEqual(seen.filter((item) => item.storage), []);
  });
});

test("子进程数据目录按扩展隔离、会被创建好，并计入占用报告", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(dir);
    const a = storage.directoryFor("ext.alpha");
    const b = storage.directoryFor("ext.beta");
    assert.notEqual(a, b);
    // AppContainer 的写路径必须是已存在的目录，所以这里要直接建好而不是等扩展自己建。
    assert.ok(existsSync(a) && existsSync(b));
    writeFileSync(join(a, "one.bin"), "12345");
    const usage = storage.usage("ext.alpha");
    assert.equal(usage.files.count, 1);
    assert.equal(usage.files.bytes, 5);
    assert.equal(usage.files.truncated, false);
    assert.equal(storage.usage("ext.beta").files.count, 0, "只统计自己那一份");
  });
});

test("目录分配同样挡住不合规的扩展标识", () => {
  withDir((dir) => {
    const storage = new FileAgentExtensionStorage(dir);
    for (const bad of ["../evil", "a/b", "UPPER"]) {
      assert.throws(() => storage.directoryFor(bad), /扩展标识不合规/);
    }
  });
});

test("宿主接线：声明了 storage 才建目录、才把它交给 MCP provider", () => {
  const server = readServerRouteSurface();
  assert.match(server, /new FileAgentExtensionStorage\(join\(DATA_DIR, "extension-data"\)\)/);
  assert.match(server, /new AgentExtensionRegistry\(AGENT_EXTENSIONS_FILE, \{ storage: agentExtensionStorage \}\)/);
  // 闸门：没声明权限就不分配目录，而不是先建好再判断。
  assert.match(server, /manifest\.permissions\.includes\("storage"\)\s*\n?\s*\? agentExtensionStorage\.directoryFor\(manifest\.id\)/);
  assert.match(server, /createMcpProviderFromManifest\(manifest, dataDir \? \{ dataDir \} : \{\}\)/);
  // 占用要报告给用户：用了他的磁盘就得看得见。
  assert.match(server, /storageUsage: extension\.manifest\.permissions\.includes\("storage"\)/);
});
