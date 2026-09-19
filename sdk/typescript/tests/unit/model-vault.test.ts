import assert from "node:assert/strict";
import test from "node:test";
import { decodeModelVault, encodeModelVault, runAtomicVaultActivation } from "../../examples/companion/model-vault.js";

test("v4 migrates to a multi-connection vault without losing its default or encrypted key", () => {
  const decoded = decodeModelVault({ version: 4, provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "manual", cipher: "cipher-a", connectionRevision: "11111111-1111-1111-1111-111111111111", models: [{ id: "manual" }], modelChecks: {} }, (cipher) => cipher === "cipher-a" ? "secret-a" : "", () => "22222222-2222-2222-2222-222222222222");
  assert.equal(decoded.connections.length, 1);
  assert.equal(decoded.connections[0]?.connection.apiKey, "secret-a");
  assert.equal(decoded.connections[0]?.connection.model, "manual");
  assert.equal(decoded.activeConnectionId, decoded.connections[0]?.id);
  assert.equal(decoded.assignments.system.chat.mode, "fixed");
  assert.deepEqual(decoded.connections[0]?.rawCatalog, [{ id: "manual" }]);
  assert.deepEqual(decoded.connections[0]?.catalog, [], "custom v4 raw目录不能迁移成官方短名单");
});

test("atomic activation restores persisted and runtime state when rebuild fails", async () => {
  const previous = decodeModelVault(undefined, () => "", () => "a");
  const next = { ...previous, activeConnectionId: "candidate" };
  let persisted = previous;
  let runtime = previous;
  await assert.rejects(runAtomicVaultActivation(previous, next, {
    persist: (vault) => { persisted = vault; },
    activate: (vault) => { runtime = vault; throw new Error("rebuild failed"); },
    restore: (vault) => { runtime = vault; },
  }), /rebuild failed/);
  assert.equal(persisted, previous);
  assert.equal(runtime, previous);
});

test("atomic activation never changes runtime when persistence fails", async () => {
  const previous = decodeModelVault(undefined, () => "", () => "a");
  const next = { ...previous, activeConnectionId: "candidate" };
  let runtime = previous;
  await assert.rejects(runAtomicVaultActivation(previous, next, {
    persist: () => { throw new Error("save failed"); },
    activate: (vault) => { runtime = vault; },
    restore: (vault) => { runtime = vault; },
  }), /save failed/);
  assert.equal(runtime, previous);
});

test("v5 migrates raw catalogs and v9 serializes raw/eligible/enabled separately with encrypted secrets", () => {
  const decoded = decodeModelVault({ version: 5, activeConnectionId: "a", connections: [
    { id: "a", label: "A", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", cipher: "enc-one", connectionRevision: "11111111-1111-1111-1111-111111111111" },
    { id: "b", label: "B", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9922/v1", model: "two", cipher: "enc-two", connectionRevision: "22222222-2222-2222-2222-222222222222" },
  ] }, (cipher) => cipher.replace("enc-", "secret-"), () => "33333333-3333-3333-3333-333333333333");
  assert.deepEqual(decoded.connections.map((item) => item.connection.model), ["one", "two"]);
  assert.deepEqual(decoded.connections.map((item) => item.connection.enabledModels), [["one"], ["two"]], "legacy selected models migrate into the enabled pool");
  const saved = encodeModelVault(decoded, (secret) => Buffer.from(secret).toString("base64"));
  assert.equal(saved.version, 9);
  assert.ok(saved.connections?.every((item) => Array.isArray(item.rawModels) && Array.isArray(item.eligibleModels)));
  assert.doesNotMatch(JSON.stringify(saved), /secret-one|secret-two/);
  assert.match(JSON.stringify(saved), /c2VjcmV0LW9uZQ==/);
  const roundTrip = decodeModelVault(saved, (cipher) => Buffer.from(cipher, "base64").toString(), () => "unused");
  assert.deepEqual(roundTrip.connections.map((item) => item.connection.enabledModels), [["one"], ["two"]]);
});

test("v7 preserves an explicitly empty enabled pool while v6 migrates fixed legacy references", () => {
  const fixed = { mode: "fixed" as const, ref: { connectionId: "a", modelId: "scene-model", capability: "chat" as const } };
  const explicit = decodeModelVault({ version: 7, activeConnectionId: "a", connections: [
    { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", enabledModels: [], connectionRevision: "11111111-1111-1111-1111-111111111111" },
  ], assignments: { system: {}, scenes: { assistant_chat: { chat: fixed } } } as any }, () => "", () => "b");
  assert.deepEqual(explicit.connections[0]?.connection.enabledModels, []);
  const legacy = decodeModelVault({ version: 6, activeConnectionId: "a", connections: [
    { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", connectionRevision: "11111111-1111-1111-1111-111111111111", modelChecks: { checked: { connectionRevision: "11111111-1111-1111-1111-111111111111", checkedAt: "2026-09-19T00:00:00.000Z", chat: "passed", streaming: "not-tested", tools: "not-tested", detail: "legacy" } } },
  ], assignments: { system: {}, scenes: { assistant_chat: { chat: fixed } } } as any }, () => "", () => "b");
  assert.deepEqual(legacy.connections[0]?.connection.enabledModels?.sort(), ["checked", "one", "scene-model"]);
});

test("legacy favorites migrate to registered models without becoming enabled", () => {
  const decoded = decodeModelVault({ version: 8, activeConnectionId: "a", connections: [{
    id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one",
    connectionRevision: "11111111-1111-1111-1111-111111111111", favoriteModels: ["saved-only", "already-enabled"], enabledModels: ["already-enabled"],
  }] }, () => "", () => "b");
  assert.deepEqual(decoded.connections[0]?.connection.registeredModels, ["saved-only", "already-enabled"]);
  assert.deepEqual(decoded.connections[0]?.connection.enabledModels, ["already-enabled"]);
  const encoded = encodeModelVault(decoded, (value) => value);
  assert.deepEqual(encoded.connections?.[0]?.registeredModels, ["saved-only", "already-enabled"]);
  assert.equal(Object.prototype.hasOwnProperty.call(encoded.connections?.[0] || {}, "favoriteModels"), false);
});

test("every legacy vault generation v2-v8 is encoded as v9 and v9 round-trips encrypted secrets", () => {
  const legacySingle = (version: 2 | 3 | 4) => ({ version, provider: "custom", protocol: "openai-compatible" as const, baseUrl: "http://127.0.0.1:9911/v1", model: `legacy-${version}`, cipher: "encrypted", connectionRevision: "11111111-1111-1111-1111-111111111111" });
  for (const version of [2, 3, 4] as const) {
    const decoded = decodeModelVault(legacySingle(version), () => "secret", () => "a");
    assert.equal(encodeModelVault(decoded, (value) => `cipher:${value}`).version, 9);
  }
  for (const version of [5, 6] as const) {
    const decoded = decodeModelVault({ version, activeConnectionId: "a", connections: [
      { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "legacy", cipher: "encrypted", connectionRevision: "11111111-1111-1111-1111-111111111111" },
    ] }, () => "secret", () => "a");
    assert.equal(encodeModelVault(decoded, (value) => `cipher:${value}`).version, 9);
  }
  const decodedV7 = decodeModelVault({ version: 7, activeConnectionId: "a", connections: [
    { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", enabledModels: [], cipher: "encrypted", connectionRevision: "11111111-1111-1111-1111-111111111111" },
  ] }, () => "secret-v7", () => "a");
  const savedV7 = encodeModelVault(decodedV7, (value) => Buffer.from(value).toString("base64"));
  assert.equal(savedV7.version, 9);
  assert.deepEqual(savedV7.connections?.[0]?.enabledModels, []);
  assert.doesNotMatch(JSON.stringify(savedV7), /secret-v7/);
  const roundTrip = decodeModelVault(savedV7, (cipher) => Buffer.from(cipher, "base64").toString(), () => "unused");
  assert.equal(roundTrip.connections[0]?.connection.apiKey, "secret-v7");
  assert.deepEqual(roundTrip.connections[0]?.connection.enabledModels, []);
});

test("legacy reasoning model assignments are ignored and chat effort preferences migrate independently", () => {
  const fixed = { mode: "fixed" as const, ref: { connectionId: "a", modelId: "one", capability: "chat" as const } };
  const decoded = decodeModelVault({ version: 6, activeConnectionId: "a", connections: [
    { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", connectionRevision: "11111111-1111-1111-1111-111111111111" },
  ], assignments: { system: { chat: fixed, reasoning: { mode: "fixed", ref: { connectionId: "a", modelId: "other", capability: "reasoning" } } } as any, scenes: { pantheon: { reasoning: { mode: "fixed", ref: { connectionId: "a", modelId: "other", capability: "reasoning" } } } } as any }, chatPreferences: { system: { reasoningEffort: "high" }, scenes: { pantheon: { reasoningEffort: "low" } } } }, () => "", () => "b");
  assert.equal("reasoning" in decoded.assignments.system, false);
  assert.equal("reasoning" in decoded.assignments.scenes.pantheon, false);
  assert.equal(decoded.chatPreferences.system.reasoningEffort, "high");
  assert.equal(decoded.chatPreferences.scenes.pantheon?.reasoningEffort, "low");
});

test("task_workspace preferences win over legacy task regardless of JSON key order", () => {
  const fixed = { mode: "fixed" as const, ref: { connectionId: "a", modelId: "one", capability: "chat" as const } };
  const base: any = { version: 6, activeConnectionId: "a", connections: [
    { id: "a", provider: "custom", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:9911/v1", model: "one", connectionRevision: "11111111-1111-1111-1111-111111111111" },
  ], assignments: { system: {}, scenes: { task: { chat: fixed } } } };
  const cases = [
    { scenes: { task: { reasoningEffort: "high" as const }, task_workspace: { reasoningEffort: "low" as const }, pantheon: { reasoningEffort: "medium" as const } }, expected: "low" },
    { scenes: { task_workspace: { reasoningEffort: "low" as const }, task: { reasoningEffort: "high" as const }, pantheon: { reasoningEffort: "medium" as const } }, expected: "low" },
    { scenes: { task: { reasoningEffort: "high" as const }, pantheon: { reasoningEffort: "medium" as const } }, expected: "high" },
    { scenes: { task_workspace: { reasoningEffort: "low" as const }, pantheon: { reasoningEffort: "medium" as const } }, expected: "low" },
  ];
  for (const item of cases) {
    const decoded = decodeModelVault({ ...base, chatPreferences: { system: { reasoningEffort: "auto" }, scenes: item.scenes } }, () => "", () => "b");
    assert.deepEqual(decoded.assignments.scenes.task_workspace.chat, fixed);
    assert.equal(decoded.chatPreferences.scenes.task_workspace?.reasoningEffort, item.expected);
    assert.equal(decoded.chatPreferences.scenes.task, undefined);
    assert.equal(decoded.chatPreferences.scenes.pantheon?.reasoningEffort, "medium", "unrelated scenes remain intact");
  }
});

test("v8 preserves current-revision capability probes and media assignments while upgrading to v9", () => {
  const revision = "11111111-1111-1111-1111-111111111111";
  const saved: any = {
    version: 8, activeConnectionId: "openai", assignments: { system: {
      vision: { mode: "fixed", ref: { connectionId: "openai", modelId: "gpt-5.4", capability: "vision" } },
      speech_to_text: { mode: "fixed", ref: { connectionId: "openai", modelId: "gpt-transcribe", capability: "speech_to_text" } },
    }, scenes: {} },
    connections: [{ id: "openai", provider: "openai", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.4", cipher: "encrypted", connectionRevision: revision, enabledModels: ["gpt-5.4", "gpt-transcribe"], capabilityChecks: {
      "vision:gpt-5.4": { connectionRevision: revision, modelId: "gpt-5.4", capability: "vision", checkedAt: "2026-09-19T00:00:00.000Z", status: "passed", detail: "ok" },
      "speech_to_text:gpt-transcribe": { connectionRevision: revision, modelId: "gpt-transcribe", capability: "speech_to_text", checkedAt: "2026-09-19T00:00:00.000Z", status: "passed", detail: "ok" },
      "vision:stale": { connectionRevision: "22222222-2222-2222-2222-222222222222", modelId: "stale", capability: "vision", checkedAt: "2026-09-19T00:00:00.000Z", status: "passed", detail: "stale" },
    } }],
  };
  const decoded = decodeModelVault(saved, () => "secret", () => "unused");
  assert.equal(decoded.connections[0]?.connection.capabilityChecks?.["vision:gpt-5.4"]?.status, "passed");
  const encoded = encodeModelVault(decoded, () => "encrypted-again");
  assert.equal(encoded.version, 9);
  assert.equal(encoded.connections?.[0]?.capabilityChecks?.["speech_to_text:gpt-transcribe"]?.status, "passed");
  assert.equal(encoded.connections?.[0]?.capabilityChecks?.["vision:stale"], undefined);
  const roundTrip = decodeModelVault(encoded, () => "secret", () => "unused");
  assert.deepEqual(roundTrip.assignments.system.vision, saved.assignments.system.vision);
  assert.deepEqual(roundTrip.assignments.system.speech_to_text, saved.assignments.system.speech_to_text);
});

test("v9 encrypts every credential separately and exposes no plaintext secret", () => {
  const revision = "11111111-1111-1111-1111-111111111111";
  const decoded = decodeModelVault({ version: 9, activeConnectionId: "hunyuan", connections: [{
    id: "hunyuan", provider: "hunyuan", protocol: "tencent-tc3", baseUrl: "https://vclm.tencentcloudapi.com", model: "hunyuan-video",
    credentialCiphers: { secretId: "cipher-id", secretKey: "cipher-key" }, providerSettings: { region: "ap-guangzhou" }, connectionRevision: revision,
    rawModels: [{ id: "visible", directory: { capabilities: ["video-generation"], contextTokens: 32000 } }],
  }] }, (cipher) => cipher === "cipher-id" ? "AKID-secret" : "secret-key-value", () => "unused");
  assert.deepEqual(decoded.connections[0]?.connection.credentials, { secretId: "AKID-secret", secretKey: "secret-key-value" });
  const encoded = encodeModelVault(decoded, (secret) => Buffer.from(secret).toString("base64"));
  assert.equal(encoded.version, 9);
  assert.deepEqual(Object.keys(encoded.connections?.[0]?.credentialCiphers || {}).sort(), ["secretId", "secretKey"]);
  assert.doesNotMatch(JSON.stringify(encoded), /AKID-secret|secret-key-value/);
  assert.deepEqual(encoded.connections?.[0]?.providerSettings, { region: "ap-guangzhou" });
  assert.deepEqual(encoded.connections?.[0]?.rawModels?.[0]?.directory, { capabilities: ["video-generation"], contextTokens: 32000 });
});
