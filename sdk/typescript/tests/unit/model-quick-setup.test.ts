import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  ModelQuickSetupBusyError,
  ModelQuickSetupCoordinator,
  normalizeModelQuickSetupSnapshot,
  runModelQuickSetup,
  type ModelQuickSetupDependencies,
  type ModelQuickSetupSnapshot,
  type QuickSetupCapability,
  type QuickSetupProvider,
  type QuickSetupTarget,
} from "../../examples/companion/model-quick-setup.js";
import { emptyCapabilityAssignments } from "../../examples/companion/model-resource-center.js";
import { decodeModelVault, defaultChatInvocationPreferences, encodeModelVault } from "../../examples/companion/model-vault.js";

function fakeSetup(options: {
  configured?: QuickSetupProvider[];
  discoveryFailure?: QuickSetupProvider;
  verificationFailure?: QuickSetupCapability;
  preserved?: QuickSetupCapability[];
} = {}) {
  const configured = new Set(options.configured || []);
  const preserved = new Set(options.preserved || []);
  const calls: string[] = [];
  const snapshots: ModelQuickSetupSnapshot[] = [];
  const targets: Record<QuickSetupProvider, QuickSetupTarget[]> = {
    openai: [
      { provider: "openai", connectionId: "openai-id", modelId: "gpt-current", capability: "chat" },
      { provider: "openai", connectionId: "openai-id", modelId: "gpt-current", capability: "vision" },
      { provider: "openai", connectionId: "openai-id", modelId: "transcribe-current", capability: "speech_to_text" },
      { provider: "openai", connectionId: "openai-id", modelId: "tts-current", capability: "text_to_speech" },
      { provider: "openai", connectionId: "openai-id", modelId: "image-current", capability: "image_generation" },
    ],
    zhipu: [{ provider: "zhipu", connectionId: "zhipu-id", modelId: "glm-current", capability: "chat" }],
  };
  const deps: ModelQuickSetupDependencies = {
    persist: (snapshot) => { snapshots.push(structuredClone(snapshot)); },
    save: async (provider, key) => {
      calls.push(`save:${provider}`);
      if (key === "auth-failure") throw new Error("API Key 无效");
      if (!key && !configured.has(provider)) return { connectionId: "" };
      configured.add(provider);
      return { connectionId: `${provider}-id` };
    },
    discover: async (provider) => {
      calls.push(`discover:${provider}`);
      if (options.discoveryFailure === provider) throw new Error("目录读取失败");
      return { targets: targets[provider], detail: "已筛选推荐" };
    },
    verify: async (target) => {
      calls.push(`verify:${target.provider}:${target.capability}`);
      if (options.verificationFailure === target.capability) return { passed: false, detail: "能力验证失败" };
      return { passed: true, detail: "能力验证通过" };
    },
    assign: async (passed, reset) => (["chat", "vision", "speech_to_text", "text_to_speech", "image_generation"] as QuickSetupCapability[]).map((capability) => {
      const target = passed.find((item) => item.capability === capability);
      if (preserved.has(capability) && !reset) return { capability, status: "preserved" as const, detail: "保留手工默认" };
      return target
        ? { capability, status: "ready" as const, target, detail: "已自动分配" }
        : { capability, status: "pending" as const, detail: "尚未配置" };
    }),
  };
  return { deps, calls, snapshots };
}

test("仅 OpenAI Key 自动验证五项能力且不探测未配置的智谱", async () => {
  const fake = fakeSetup();
  const result = await runModelQuickSetup({ requestId: "request-openai", keys: { openai: "openai-key" } }, fake.deps);
  assert.equal(result.stage, "complete");
  assert.equal(result.providerResults.find((item) => item.provider === "zhipu")?.status, "pending");
  assert.equal(fake.calls.filter((item) => item.startsWith("verify:openai")).length, 5);
  assert.equal(fake.calls.some((item) => item.startsWith("discover:zhipu")), false);
  assert.equal(result.capabilityResults.find((item) => item.capability === "video_generation")?.status, "unsupported");
});

test("自动配置通过本地 HTTP fake provider 完成目录读取与逐能力验证", async () => {
  const requests: string[] = [];
  const provider = createServer((req, res) => {
    requests.push(req.url || "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/models") res.end(JSON.stringify({ models: ["gpt-current", "transcribe-current", "tts-current", "image-current"] }));
    else if (req.url?.startsWith("/probe/")) res.end(JSON.stringify({ ok: true }));
    else { res.writeHead(404); res.end(JSON.stringify({ ok: false })); }
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const fake = fakeSetup();
  const deps: ModelQuickSetupDependencies = {
    ...fake.deps,
    discover: async (name, connectionId) => {
      if (name !== "openai") throw new Error("unexpected provider");
      const response = await fetch(base + "/models");
      assert.equal(response.ok, true);
      const payload = await response.json() as { models: string[] };
      const model = payload.models[0]!;
      return {
        detail: "fake provider directory ready",
        targets: [
          { provider: name, connectionId, modelId: model, capability: "chat" },
          { provider: name, connectionId, modelId: model, capability: "vision" },
        ],
      };
    },
    verify: async (target) => {
      const response = await fetch(`${base}/probe/${target.capability}`);
      return { passed: response.ok && ((await response.json()) as { ok: boolean }).ok, detail: "fake probe passed" };
    },
  };
  try {
    const result = await runModelQuickSetup({ requestId: "request-http01", keys: { openai: "fixture-key" } }, deps);
    assert.equal(result.capabilityResults.find((item) => item.capability === "chat")?.status, "ready");
    assert.deepEqual(requests, ["/models", "/probe/chat", "/probe/vision"]);
  } finally {
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});

test("仅智谱 Key 配好文字，其他能力保持明确未通过", async () => {
  const fake = fakeSetup();
  const result = await runModelQuickSetup({ requestId: "request-zhipu1", keys: { zhipu: "zhipu-key" } }, fake.deps);
  assert.equal(result.stage, "partial");
  assert.equal(result.capabilityResults.find((item) => item.capability === "chat")?.modelId, "glm-current");
  assert.equal(fake.calls.filter((item) => item.startsWith("verify:")).length, 1);
});

test("双 Key 时每个 Key 各做一次最小连接验证，能力默认仍稳定优先 OpenAI", async () => {
  const fake = fakeSetup();
  const result = await runModelQuickSetup({ requestId: "request-both01", keys: { openai: "one", zhipu: "two" } }, fake.deps);
  assert.equal(result.stage, "complete");
  assert.equal(fake.calls.includes("discover:zhipu"), true);
  assert.equal(fake.calls.filter((item) => item === "verify:zhipu:chat").length, 1);
  assert.equal(result.capabilityResults.find((item) => item.capability === "chat")?.provider, "openai");
});

test("认证、目录和单能力失败都局部收敛且不阻断可用能力", async () => {
  const auth = fakeSetup();
  const authResult = await runModelQuickSetup({ requestId: "request-auth01", keys: { openai: "auth-failure", zhipu: "ok" } }, auth.deps);
  assert.equal(authResult.providerResults.find((item) => item.provider === "openai")?.status, "failed");
  assert.equal(authResult.capabilityResults.find((item) => item.capability === "chat")?.status, "ready");

  const directory = fakeSetup({ discoveryFailure: "openai" });
  const directoryResult = await runModelQuickSetup({ requestId: "request-dir001", keys: { openai: "ok", zhipu: "ok" } }, directory.deps);
  assert.equal(directoryResult.providerResults.find((item) => item.provider === "openai")?.status, "failed");
  assert.equal(directoryResult.capabilityResults.find((item) => item.capability === "chat")?.provider, "zhipu");

  const capability = fakeSetup({ verificationFailure: "image_generation" });
  const capabilityResult = await runModelQuickSetup({ requestId: "request-cap001", keys: { openai: "ok" } }, capability.deps);
  assert.equal(capabilityResult.stage, "partial");
  assert.equal(capabilityResult.capabilityResults.find((item) => item.capability === "image_generation")?.status, "failed");
  assert.equal(capabilityResult.capabilityResults.find((item) => item.capability === "speech_to_text")?.status, "ready");
});

test("健康手工默认会保留，显式恢复推荐才替换", async () => {
  const preserved = fakeSetup({ preserved: ["chat"] });
  const first = await runModelQuickSetup({ requestId: "request-keep01", keys: { openai: "ok" } }, preserved.deps);
  assert.equal(first.capabilityResults.find((item) => item.capability === "chat")?.status, "preserved");
  const reset = await runModelQuickSetup({ requestId: "request-reset1", keys: { openai: "ok" }, resetRecommendations: true }, preserved.deps);
  assert.equal(reset.capabilityResults.find((item) => item.capability === "chat")?.status, "ready");
});

test("默认分配失败不会伪报完成，已验证能力保持可重试", async () => {
  const fake = fakeSetup();
  const result = await runModelQuickSetup({ requestId: "request-assign1", keys: { openai: "ok" } }, {
    ...fake.deps,
    assign: async () => { throw new Error("写入默认路由失败"); },
  });
  assert.equal(result.stage, "partial");
  assert.match(result.message, /默认分配失败.*请重试/);
  assert.equal(result.capabilityResults.some((item) => item.status === "ready"), false);
  assert.match(result.capabilityResults.find((item) => item.capability === "chat")?.detail || "", /验证已通过.*默认分配未完成/);
});

test("协调器合并双击、拒绝并发异操作并复用重启后结果", async () => {
  const coordinator = new ModelQuickSetupCoordinator();
  let resolve!: (value: ModelQuickSetupSnapshot) => void;
  const pending = new Promise<ModelQuickSetupSnapshot>((done) => { resolve = done; });
  const first = coordinator.run("request-dedupe", undefined, () => pending);
  const second = coordinator.run("request-dedupe", undefined, async () => { throw new Error("不应执行"); });
  assert.equal(second.reused, true);
  assert.equal(second.promise, first.promise);
  assert.throws(() => coordinator.run("request-other1", undefined, async () => ({} as ModelQuickSetupSnapshot)), ModelQuickSetupBusyError);
  const completed = { ...await runModelQuickSetup({ requestId: "request-final1", keys: {} }, fakeSetup().deps), stage: "failed" as const };
  resolve(completed);
  await first.promise;
  const afterRestart = new ModelQuickSetupCoordinator().run(completed.requestId, completed, async () => { throw new Error("不应执行"); });
  assert.equal(afterRestart.reused, true);
  assert.equal((await afterRestart.promise).requestId, completed.requestId);
});

test("服务重启时把未完成状态标记为可重试的中断状态", () => {
  const normalized = normalizeModelQuickSetupSnapshot({
    requestId: "request-running", stage: "verifying", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    resetRecommendations: false, providerResults: [], capabilityResults: [], message: "running",
  });
  assert.equal(normalized?.stage, "interrupted");
  assert.match(normalized?.message || "", /可以重新执行/);
});

test("最终配置摘要随加密模型仓持久化并在服务重启后恢复", async () => {
  const final = await runModelQuickSetup({ requestId: "request-persist", keys: { zhipu: "ok" } }, fakeSetup().deps);
  const encoded = encodeModelVault({
    activeConnectionId: null,
    connections: [],
    assignments: emptyCapabilityAssignments(),
    chatPreferences: defaultChatInvocationPreferences(),
    quickSetup: final,
  }, (value) => `encrypted:${value}`);
  const decoded = decodeModelVault(encoded, (value) => value.replace(/^encrypted:/, ""), () => "fixture-id");
  assert.equal(decoded.quickSetup?.requestId, final.requestId);
  assert.equal(decoded.quickSetup?.stage, final.stage);
  assert.deepEqual(decoded.quickSetup?.capabilityResults, final.capabilityResults);
});
