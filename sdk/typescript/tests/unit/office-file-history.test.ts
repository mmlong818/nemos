import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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

test("结构化修改会形成真实文件版本和审计事件", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-office-structured-history-"));
  try {
    const original = await exportOfficeDocument({ name: "report", format: "docx", blocks: [{ title: "正文", text: "旧内容" }] });
    const store = new OfficeFileSessionStore(directory);
    const created = store.create("report.docx", original.data);
    const result = await store.applyStructuredEdit(created.id, created.contentHash, [{ title: "正文", text: "新内容" }]);
    assert.notEqual(result.session.contentHash, created.contentHash);
    assert.equal(store.history(created.id)[0]?.reason, "structured-edit");
    assert.equal(store.eventHistory(created.id).at(-1)?.type, "structured-edit");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
