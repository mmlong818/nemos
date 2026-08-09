import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TaskFileRegistry } from "../../examples/companion/task-files.js";

test("统一文件登记会按来源去重并保留跨重启索引", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-task-files-"));
  try {
    const file = join(directory, "files.json");
    const store = new TaskFileRegistry(file);
    const first = store.register({
      sourceKey: "office:one",
      ownerKind: "office",
      ownerId: "one",
      displayName: "计划.md",
      extension: "md",
      byteLength: 8,
      contentHash: "abc",
      storageRef: "one",
    });
    const updated = store.register({
      sourceKey: "office:one",
      ownerKind: "office",
      ownerId: "one",
      displayName: "新计划.md",
      extension: "md",
      byteLength: 12,
      contentHash: "def",
      storageRef: "one",
    });
    assert.equal(updated.id, first.id);
    assert.equal(new TaskFileRegistry(file).list("office", "one")[0]?.displayName, "新计划.md");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("同一个文件跨对话与任务流转时保持一个编号和多个归属", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-task-file-links-"));
  try {
    const file = join(directory, "files.json");
    const store = new TaskFileRegistry(file);
    const created = store.register({
      sourceKey: "office:one",
      ownerKind: "office",
      ownerId: "one",
      displayName: "brief.md",
      extension: "md",
      byteLength: 12,
      contentHash: "abc",
      storageRef: "one",
    });
    const linked = store.link(created.id, "conversation", "group:demo", "conversation:group:demo:message-1");
    store.link(created.id, "task", "job-1", "task:job-1:file");
    assert.equal(linked.id, created.id);
    assert.equal(store.list("conversation", "group:demo")[0]?.id, created.id);
    assert.equal(store.list("task", "job-1")[0]?.id, created.id);
    assert.equal(new TaskFileRegistry(file).get(created.id)?.owners.length, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("聊天端预分配的合法文件编号会成为统一编号", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-task-files-client-id-"));
  try {
    const registry = new TaskFileRegistry(join(directory, "files.json"));
    const fileId = "file-12345678-1234-4234-8234-123456789abc";
    const record = registry.register({
      fileId,
      sourceKey: "conversation:chat:message",
      ownerKind: "conversation",
      ownerId: "chat",
      displayName: "材料.md",
      extension: "md",
      byteLength: 8,
      contentHash: "hash",
      storageRef: "message:message",
    });
    assert.equal(record.id, fileId);
    assert.equal(registry.get(fileId)?.id, fileId);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("旧版单归属文件索引会在读取时迁移", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-task-file-migration-"));
  try {
    const file = join(directory, "files.json");
    const id = "file-11111111-1111-4111-8111-111111111111";
    writeFileSync(file, JSON.stringify([{
      id,
      sourceKey: "artifact:legacy",
      ownerKind: "artifact",
      ownerId: "legacy",
      displayName: "legacy.md",
      extension: "md",
      byteLength: 1,
      contentHash: "a",
      storageRef: "legacy",
      status: "active",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }]));
    const restored = new TaskFileRegistry(file).get(id);
    assert.deepEqual(restored?.sourceKeys, ["artifact:legacy"]);
    assert.equal(restored?.owners[0]?.kind, "artifact");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
