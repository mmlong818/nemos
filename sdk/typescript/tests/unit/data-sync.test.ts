import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPendingDataRestore, createEncryptedDataSnapshot, decryptDataSnapshot, normalizeSyncEndpoint, stageDataRestore } from "../../examples/companion/data-sync.js";

test("远程同步强制 HTTPS，但允许本机 Docker 使用 HTTP", () => {
  assert.equal(normalizeSyncEndpoint("http://127.0.0.1:8799/"), "http://127.0.0.1:8799");
  assert.equal(normalizeSyncEndpoint("https://sync.example.com/"), "https://sync.example.com");
  assert.throws(() => normalizeSyncEndpoint("http://sync.example.com"), /HTTPS/);
});

test("服务器同步快照端到端加密并排除本机密钥", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-sync-"));
  try {
    writeFileSync(join(dir, "user-profile.json"), JSON.stringify({ name: "猫叔" }));
    writeFileSync(join(dir, "llm-key.dpapi.json"), "secret");
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs", "debug.log"), "private");
    const encrypted = createEncryptedDataSnapshot(dir, "device-a", "a-safe-passphrase-123");
    assert.doesNotMatch(encrypted.ciphertext, /猫叔|secret|private/);
    const plain = decryptDataSnapshot(encrypted, "a-safe-passphrase-123");
    assert.deepEqual(plain.files.map((file) => file.path), ["user-profile.json"]);
    assert.throws(() => decryptDataSnapshot(encrypted, "wrong-passphrase-123"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("服务器恢复先暂存并只在下次启动应用", () => {
  const source = mkdtempSync(join(tmpdir(), "clownfish-sync-source-"));
  const target = mkdtempSync(join(tmpdir(), "clownfish-sync-target-"));
  try {
    writeFileSync(join(source, "preferences.json"), JSON.stringify({ style: "clean" }));
    writeFileSync(join(target, "preferences.json"), JSON.stringify({ style: "old" }));
    const encrypted = createEncryptedDataSnapshot(source, "device-a", "a-safe-passphrase-123");
    const staged = stageDataRestore(target, encrypted, "a-safe-passphrase-123");
    assert.equal(staged.fileCount, 1);
    assert.match(readFileSync(join(target, "preferences.json"), "utf8"), /old/);
    assert.deepEqual(applyPendingDataRestore(target), { applied: true, fileCount: 1 });
    assert.match(readFileSync(join(target, "preferences.json"), "utf8"), /clean/);
  } finally { rmSync(source, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }); }
});
