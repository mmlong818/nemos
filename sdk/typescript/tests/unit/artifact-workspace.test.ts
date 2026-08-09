import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ArtifactWorkspaceStore } from "../../examples/companion/artifact-workspace.js";

test("工作台状态和版本在重启后仍可恢复", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-artifact-workspace-"));
  const file = join(dir, "artifact-workspaces.json");
  try {
    const store = new ArtifactWorkspaceStore(file);
    const saved = store.saveVersion("art-1", {
      notes: { workbenchNotes: "用户确认先做本地版本" },
      checks: { "success-0": true, "success-1": false },
      values: { demandWeight: "45" },
      status: "review",
    });
    assert.equal(saved.versions.length, 1);

    store.saveCurrent("art-1", {
      notes: { workbenchNotes: "后来改成先验证" },
      checks: { "success-0": false },
      values: { demandWeight: "70" },
      status: "draft",
    });
    const restored = new ArtifactWorkspaceStore(file).restoreVersion("art-1", saved.versions[0]!.id);
    assert.equal(restored.notes.workbenchNotes, "用户确认先做本地版本");
    assert.equal(restored.checks["success-0"], true);
    assert.equal(restored.values.demandWeight, "45");
    assert.equal(restored.status, "review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("工作台输入有明确容量和字段边界", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-artifact-workspace-limits-"));
  try {
    const store = new ArtifactWorkspaceStore(join(dir, "state.json"));
    const state = store.saveCurrent("art-safe", {
      notes: { "workbench Notes<script>": "x".repeat(25_000) },
      checks: Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`check-${index}`, true])),
      status: "unknown",
    });
    assert.equal(Object.keys(state.notes)[0], "workbenchNotesscript");
    assert.equal(Object.values(state.notes)[0]?.length, 20_000);
    assert.equal(Object.keys(state.checks).length, 200);
    assert.equal(state.status, "draft");
    assert.throws(() => store.get("../outside"), /编号无效/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("交接上下文包含用户在工作台确认的状态", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-artifact-workspace-context-"));
  try {
    const store = new ArtifactWorkspaceStore(join(dir, "state.json"));
    store.saveCurrent("art-context", {
      notes: { workbenchNotes: "优先保证新用户三分钟内开始" },
      checks: { "acceptance-keyboard": true },
      status: "done",
    });
    const context = store.context("art-context");
    assert.match(context, /已确认/);
    assert.match(context, /三分钟内开始/);
    assert.match(context, /acceptance-keyboard/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("研究正文可编辑但证据包不可被保存请求覆盖", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-evidence-workspace-"));
  try {
    const store = new ArtifactWorkspaceStore(join(dir, "state.json"));
    const initialized = store.initializeEvidence("research-1", {
      hash: "a".repeat(64),
      sourceCount: 2,
      anchorCount: 3,
      capturedAt: "2026-08-07T00:00:00.000Z",
    }, "原始正文");
    const saved = store.saveCurrent("research-1", {
      body: "用户修改后的正文",
      notes: {},
      checks: {},
      status: "review",
      evidence: { hash: "tampered" },
    }, initialized.revision);
    assert.equal(saved.body, "用户修改后的正文");
    assert.equal(saved.evidence?.hash, "a".repeat(64));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("工作台拒绝基于旧版本的并发覆盖", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-workspace-conflict-"));
  try {
    const store = new ArtifactWorkspaceStore(join(dir, "state.json"));
    const base = store.get("art-conflict");
    const first = store.saveCurrent("art-conflict", { body: "第一处修改" }, base.revision);
    assert.equal(first.revision, 1);
    assert.throws(
      () => store.saveCurrent("art-conflict", { body: "静默覆盖" }, base.revision),
      /已在别处更新/,
    );
    assert.equal(store.get("art-conflict").body, "第一处修改");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
