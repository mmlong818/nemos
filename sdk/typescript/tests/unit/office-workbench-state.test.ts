import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OfficeWorkbenchRevisionConflict, OfficeWorkbenchStateStore } from "../../examples/companion/office-workbench-state.js";

test("文件工作台状态可跨重启恢复，并拒绝旧窗口覆盖新修改", () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-workbench-state-"));
  try {
    const file = join(directory, "state.json");
    const store = new OfficeWorkbenchStateStore(file);
    const saved = store.save({ expectedRevision: 0, documents: [{ id: "document-1", name: "方案" }], trash: [], selectedId: "document-1" });
    assert.equal(saved.revision, 1);
    assert.equal(new OfficeWorkbenchStateStore(file).read().documents.length, 1);
    assert.throws(
      () => store.save({ expectedRevision: 0, documents: [], trash: [], selectedId: null }),
      (error) => error instanceof OfficeWorkbenchRevisionConflict && error.current.revision === 1,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
