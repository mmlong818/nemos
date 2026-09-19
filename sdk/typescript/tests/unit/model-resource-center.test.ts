import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_CAPABILITIES,
  MODEL_APPLICATION_SCENES,
  MODEL_SCENES,
  CURATED_MODEL_CATALOG,
  allResourcesForConnection,
  capabilityAdapterSupport,
  providerCapabilityAdapterSupport,
  candidateModelResources,
  checkedModelResource,
  detectCompanionProvider,
  eligibleCuratedCatalog,
  explainAutomaticRoute,
  maintainedModelResources,
  normalizeCapabilityAssignments,
  planOnboardingModel,
  validateFixedAssignment,
} from "../../examples/companion/model-resource-center.js";

test("resource taxonomy and scene overrides stay explicit", () => {
  assert.deepEqual(MODEL_CAPABILITIES, ["chat", "vision", "image_generation", "speech_to_text", "text_to_speech", "video_generation", "embedding"]);
  assert.deepEqual(MODEL_SCENES, ["assistant_chat", "task_workspace", "pantheon", "distillation"]);
  assert.deepEqual(MODEL_APPLICATION_SCENES.map(({ id, name }) => ({ id, name })), [
    { id: "assistant_chat", name: "助理" },
    { id: "task_workspace", name: "任务工作区" },
    { id: "pantheon", name: "万神殿" },
    { id: "distillation", name: "思维蒸馏" },
  ]);
  assert.ok(MODEL_APPLICATION_SCENES.every((scene) => scene.executionState === "wired" && scene.modelOverride && scene.reasoningOverride && scene.executionEntries.length));
});

test("capability support reflects the unified execution path, not provider marketing", () => {
  assert.equal(capabilityAdapterSupport("chat").state, "available");
  assert.ok(capabilityAdapterSupport("chat").adapters.includes("anthropic-messages"));
  for (const capability of ["vision", "speech_to_text", "text_to_speech", "image_generation", "video_generation", "embedding"] as const) {
    assert.equal(capabilityAdapterSupport(capability).state, "integration_pending");
    assert.equal(capabilityAdapterSupport(capability).adapters.length, 0);
    assert.ok(capabilityAdapterSupport(capability).reason.length > 8);
  }
  for (const capability of ["vision", "speech_to_text", "text_to_speech", "image_generation"] as const) {
    assert.equal(providerCapabilityAdapterSupport("openai", "https://api.openai.com/v1", capability).state, "available");
    assert.equal(providerCapabilityAdapterSupport("custom", "https://api.openai.com/v1", capability).state, "integration_pending");
  }
});

test("provider detection uses exact maintained endpoints and never guesses custom gateways", () => {
  assert.equal(detectCompanionProvider("https://api.openai.com/v1").provider, "openai");
  assert.equal(detectCompanionProvider("https://api.openai.com.evil.test/v1").provider, "custom");
  assert.equal(detectCompanionProvider("https://api.openai.com/compatible/v1").provider, "custom");
  assert.equal(detectCompanionProvider("http://127.0.0.1:1234/v1").provider, "custom");
  assert.equal(detectCompanionProvider("https://api.minimaxi.com/v1").provider, "custom");
  assert.equal(detectCompanionProvider("https://api.minimax.io/v1").provider, "custom");
  assert.equal(detectCompanionProvider("https://api.minimax.cn/v1").provider, "minimax");
});

test("versioned official catalog exposes only active recommended wired chat entries", () => {
  assert.equal(CURATED_MODEL_CATALOG.catalogVersion, "2026-09-18.1");
  assert.equal(CURATED_MODEL_CATALOG.retrievedAt, "2026-09-18");
  assert.ok(CURATED_MODEL_CATALOG.providers.every((provider) => provider.sourceUrl.startsWith("https://")));
  assert.deepEqual(eligibleCuratedCatalog("zhipu", "https://open.bigmodel.cn/api/paas/v4").map((item) => item.id), ["glm-5.3"]);
  assert.deepEqual(eligibleCuratedCatalog("openai", "https://api.openai.com/v1").map((item) => item.id), ["gpt-5.4"]);
  assert.deepEqual(eligibleCuratedCatalog("minimax", "https://api.minimax.cn/v1"), []);
  assert.deepEqual(eligibleCuratedCatalog("custom", "http://127.0.0.1:1234/v1"), []);
});

test("explicit onboarding IDs never fall back while auto alone may choose curated primary", () => {
  const endpoint = "https://open.bigmodel.cn/api/paas/v4";
  assert.throws(() => planOnboardingModel({ provider: "zhipu", baseUrl: endpoint, rawCatalog: [{ id: "glm-5.2" }], requestedModel: "glm-5.3-typo", selectionMode: "manual" }), /未发现指定型号.*没有发送/);
  assert.deepEqual(planOnboardingModel({ provider: "zhipu", baseUrl: endpoint, rawCatalog: [{ id: "glm-5.2" }], requestedModel: "glm-5.3", selectionMode: "manual" }), { model: "glm-5.3", automatic: false, requiresUnlistedConfirmation: true });
  assert.deepEqual(planOnboardingModel({ provider: "zhipu", baseUrl: endpoint, rawCatalog: [], selectionMode: "auto" }), { model: "glm-5.3", automatic: true, requiresUnlistedConfirmation: false });
  assert.throws(() => planOnboardingModel({ provider: "deepseek", baseUrl: "https://api.deepseek.com", rawCatalog: [{ id: "deepseek-v4-flash" }], requestedModel: "deepseek-v4-flash", selectionMode: "manual" }), /停止推荐.*deepseek-flash/);
  assert.throws(() => planOnboardingModel({ provider: "custom", baseUrl: "http://127.0.0.1:1234/v1", rawCatalog: [{ id: "local" }], selectionMode: "auto" }), /没有.*官方推荐/);
});

test("maintained resources only claim capabilities already wired in product code", () => {
  const resources = maintainedModelResources("zhipu");
  assert.ok(resources.some((item) => item.modelId === "glm-4.6v-flash" && item.capabilities.includes("vision")));
  assert.ok(resources.some((item) => item.modelId === "glm-tts" && item.capabilities.includes("text_to_speech")));
  assert.ok(resources.some((item) => item.modelId === "glm-asr-2512" && item.capabilities.includes("speech_to_text")));
  assert.equal(resources.some((item) => item.capabilities.includes("video_generation")), false);
  assert.ok(resources.every((item) => item.evidence.source && item.evidence.updatedAt));
});

test("catalog candidates filter obvious non-chat and legacy entries without inventing capability tags", () => {
  const candidates = candidateModelResources("connection-a", [
    { id: "gpt-chat-current", created: 30 }, { id: "whisper-1", created: 40 },
    { id: "old-legacy-chat", created: 50 }, { id: "gpt-chat-previous", created: 20 },
  ]);
  assert.deepEqual(candidates.map((item) => item.modelId), ["gpt-chat-current", "gpt-chat-previous"]);
  assert.equal(candidates[0]?.tags, undefined);
  assert.equal(candidates.every((item) => item.autoEligible === false), true);
  assert.match(candidates[0]?.reason || "", /目录.*时间/);
});

test("fixed assignments require verified current execution evidence", () => {
  const resource = maintainedModelResources("zhipu").find((item) => item.capabilities.includes("text_to_speech"))!;
  const fixed = { mode: "fixed" as const, ref: { connectionId: "z", modelId: resource.modelId, capability: "text_to_speech" as const } };
  assert.throws(() => validateFixedAssignment(fixed, [{ ...resource, connectionId: "z" }]), /接入中/);
  const chat = checkedModelResource("z", "chat", new Date().toISOString(), ["chat"]);
  assert.doesNotThrow(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "z", modelId: "chat", capability: "chat" } }, [chat]));
  assert.throws(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "z", modelId: "directory", capability: "chat" } }, candidateModelResources("z", [{ id: "directory" }])), /尚未通过/);
  assert.throws(() => validateFixedAssignment({ ...fixed, ref: { ...fixed.ref, capability: "video_generation" } }, [{ ...resource, connectionId: "z" }]), /能力不匹配/);
  const normalized = normalizeCapabilityAssignments({ text_to_speech: fixed }, {});
  assert.equal(normalized.system.text_to_speech.mode, "fixed");
});

test("legacy task overrides migrate to the task workspace without affecting other applications", () => {
  const fixed = { mode: "fixed" as const, ref: { connectionId: "a", modelId: "chat", capability: "chat" as const } };
  const normalized = normalizeCapabilityAssignments({}, { task: { chat: fixed } } as any);
  assert.deepEqual(normalized.scenes.task_workspace.chat, fixed);
  assert.deepEqual(normalized.scenes.assistant_chat, {});
  assert.deepEqual(normalized.scenes.pantheon, {});
  assert.deepEqual(normalized.scenes.distillation, {});
});

test("retired fixed references remain representable but cannot be selected again", () => {
  const resources = allResourcesForConnection({ id: "deepseek", provider: "deepseek", baseUrl: "https://api.deepseek.com", catalog: [{ id: "deepseek-flash" }],
    checks: { "deepseek-v4-flash": { checkedAt: new Date().toISOString(), chat: "passed" } }, reasoningModels: [] });
  const retired = resources.find((item) => item.modelId === "deepseek-v4-flash")!;
  assert.equal(retired.lifecycle, "retired");
  assert.equal(retired.replacement, "deepseek-flash");
  assert.throws(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "deepseek", modelId: retired.modelId, capability: "chat" } }, resources), /停止推荐.*deepseek-flash/);
  const preserved = normalizeCapabilityAssignments({ chat: { mode: "fixed", ref: { connectionId: "deepseek", modelId: retired.modelId, capability: "chat" } } }, {});
  assert.equal(preserved.system.chat.mode, "fixed", "加载旧配置不能静默替换引用");
});

test("automatic routing only scores present evidence and explains fallback", () => {
  const now = new Date().toISOString();
  const route = explainAutomaticRoute("chat", [
    { connectionId: "a", modelId: "slow", capabilities: ["chat"], executionState: { chat: "available" }, autoEligible: true, evidence: { source: "explicit-check", updatedAt: now, verified: true, health: "healthy", latencyMs: 900 } },
    { connectionId: "b", modelId: "fast", capabilities: ["chat"], executionState: { chat: "available" }, autoEligible: true, evidence: { source: "explicit-check", updatedAt: now, verified: true, health: "healthy", latencyMs: 120 } },
    { connectionId: "c", modelId: "unknown", capabilities: ["chat"], evidence: { source: "provider-directory", updatedAt: now, verified: false } },
  ]);
  assert.equal(route.selected?.modelId, "fast");
  assert.deepEqual(route.fallbacks.map((item) => item.modelId), ["slow"]);
  assert.doesNotMatch(route.reason, /cost|成本/);
});

test("disabled models remain visible evidence but cannot be fixed or automatically routed", () => {
  const now = new Date().toISOString();
  const disabled = { connectionId: "a", modelId: "disabled", enabled: false, capabilities: ["chat" as const], executionState: { chat: "available" as const }, autoEligible: true, evidence: { source: "explicit-check" as const, updatedAt: now, verified: true, health: "healthy" as const } };
  const enabled = { ...disabled, modelId: "enabled", enabled: true };
  assert.throws(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "a", modelId: "disabled", capability: "chat" } }, [disabled]), /尚未.*启用/);
  assert.equal(explainAutomaticRoute("chat", [disabled, enabled]).selected?.modelId, "enabled");
});

test("official OpenAI media probes become routable per capability without blessing another model", () => {
  const rows = [
    ["vision:gpt-5.4", { modelId: "gpt-5.4", capability: "vision" as const }],
    ["speech_to_text:gpt-transcribe", { modelId: "gpt-transcribe", capability: "speech_to_text" as const }],
    ["text_to_speech:gpt-4o-mini-tts", { modelId: "gpt-4o-mini-tts", capability: "text_to_speech" as const }],
    ["image_generation:gpt-image-2.5-flare", { modelId: "gpt-image-2.5-flare", capability: "image_generation" as const }],
  ] as const;
  const checks = Object.fromEntries(rows.map(([key, value]) => [key, { modelId: value.modelId, capability: value.capability, checkedAt: new Date().toISOString(), status: "passed" }]));
  const resources = allResourcesForConnection({ id: "official", provider: "openai", baseUrl: "https://api.openai.com/v1", catalog: [], checks: {},
    enabledModels: ["gpt-5.4", "gpt-transcribe", "gpt-4o-mini-tts", "gpt-image-2.5-flare"], capabilityChecks: checks });
  for (const check of Object.values(checks) as Array<{ modelId: string; capability: "vision" | "speech_to_text" | "text_to_speech" | "image_generation" }>) {
    const assignment = { mode: "fixed" as const, ref: { connectionId: "official", modelId: check.modelId, capability: check.capability } };
    assert.doesNotThrow(() => validateFixedAssignment(assignment, resources));
    assert.equal(explainAutomaticRoute(check.capability, resources).selected?.modelId, check.modelId);
  }
  assert.throws(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "official", modelId: "gpt-transcribe", capability: "vision" } }, resources), /不匹配|证据/);
  assert.throws(() => validateFixedAssignment({ mode: "fixed", ref: { connectionId: "other", modelId: "gpt-5.4", capability: "vision" } }, resources), /不匹配|证据/);
});
