import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OfficeFileSessionStore } from "../../examples/companion/office-file-sessions.js";
import { exportOfficeDocument } from "../../examples/companion/office-export.js";

test("读取版本列表时会主动发现桌面应用的外部修改", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-history-scan-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("notes.md", Buffer.from("before"));
    writeFileSync(created.file, "after", "utf8");
    const history = store.history(created.id);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.reason, "external-change");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("文件重命名和删除会留下不暴露路径的状态事件", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-events-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("notes.md", Buffer.from("content"));
    const renamed = join(directory, "renamed.md");
    renameSync(created.file, renamed);
    assert.equal(store.inspect(created.id).file, renamed);
    assert.equal(store.eventHistory(created.id).at(-1)?.type, "renamed");
    unlinkSync(renamed);
    assert.equal(store.eventHistory(created.id).at(-1)?.type, "missing");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("文字替换生成新文件，打开的文件保持不变", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-structured-history-"));
  try {
    const original = await exportOfficeDocument({ name: "report", format: "docx", blocks: [{ title: "正文", text: "旧内容" }] });
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("report.docx", original.data);
    const result = await store.saveStructuredCopy(created.id, created.contentHash, [{ title: "正文", text: "新内容" }]);
    assert.notEqual(result.copy.id, created.id);
    assert.notEqual(result.copy.contentHash, created.contentHash);
    assert.equal(store.inspect(created.id).contentHash, created.contentHash);
    assert.equal(readFileSync(created.file).equals(original.data), true);
    assert.match(result.copy.name, /文字副本/);
    assert.equal(store.eventHistory(created.id).at(-1)?.type, "structured-copy");
    assert.equal(store.history(result.copy.id)[0]?.reason, "imported");
    assert.ok(result.warnings.some((warning) => warning.includes("行内格式")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("文字替换拒绝在不支持副本的格式上执行", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-structured-guard-"));
  try {
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("notes.md", Buffer.from("content"));
    await assert.rejects(() => store.saveStructuredCopy(created.id, created.contentHash, [{ title: "正文", text: "新内容" }]), /不支持文字替换副本/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
