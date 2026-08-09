import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OfficeFileSessionStore } from "../../examples/companion/office-file-sessions.js";

test("办公文件会话保存真实字节、内容指纹并在重启后恢复", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-office-session-"));
  try {
    const store = new OfficeFileSessionStore(dir);
    const created = store.create("季度汇报.docx", Buffer.from("PK-test-office-content"));
    assert.match(created.id, /^office-/);
    assert.match(created.contentHash, /^[a-f0-9]{64}$/);
    assert.equal(readFileSync(created.file, "utf8"), "PK-test-office-content");
    const restored = new OfficeFileSessionStore(dir).read(created.id);
    assert.equal(restored.session.contentHash, created.contentHash);
    assert.equal(restored.data.toString(), "PK-test-office-content");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("桌面应用保存后重新核算字节和指纹", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-office-refresh-"));
  try {
    const store = new OfficeFileSessionStore(dir);
    const created = store.create("notes.md", Buffer.from("old"));
    writeFileSync(created.file, "new content", "utf8");
    const refreshed = store.inspect(created.id);
    assert.equal(refreshed.byteLength, Buffer.byteLength("new content"));
    assert.notEqual(refreshed.contentHash, created.contentHash);
    const history = store.history(created.id);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.reason, "external-change");
    const restored = store.restore(created.id, history[1]!.id, refreshed.contentHash);
    assert.equal(readFileSync(restored.file, "utf8"), "old");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("恢复旧版本前会检查当前文件指纹", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-office-conflict-"));
  try {
    const store = new OfficeFileSessionStore(dir);
    const created = store.create("notes.txt", Buffer.from("first"));
    assert.throws(() => store.restore(created.id, store.history(created.id)[0]!.id, "stale"), /其他程序中变化/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("文件会话拒绝未知格式和伪造编号", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-office-boundary-"));
  try {
    const store = new OfficeFileSessionStore(dir);
    assert.throws(() => store.create("script.exe", Buffer.from("x")), /不支持/);
    assert.throws(() => store.read("..\\secret"), /编号无效/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
