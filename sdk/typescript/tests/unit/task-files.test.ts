import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
