// development-proposal-apply.test.ts — v0.8 提案写入闭环
//
// 验证：写入后核对落盘结果、中途失败整体还原、已写入的提案可回滚、
//       以及写入之后被人改过时回滚会停下来而不是抹掉别人的修改。

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DevelopmentProposalStore } from "../../examples/companion/development-proposals.js";

function setup(): { workspace: string; store: DevelopmentProposalStore; cleanup: () => void } {
  const workspace = mkdtempSync(join(tmpdir(), "clownfish-proposal-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "clownfish-proposal-data-"));
  const store = new DevelopmentProposalStore(dataDir);
  return {
    workspace,
    store,
    cleanup: () => {
      for (const dir of [workspace, dataDir]) rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("写入后逐个核对落盘内容，通过才算已写入", () => {
  const { workspace, store, cleanup } = setup();
  try {
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    session.write(join(workspace, "sub", "b.txt"), "新建的 B\n");
    const staged = session.finalize();
    assert.equal(staged.state, "pending");
    // 确认之前项目里不该有任何改动。
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "原始 A\n");
    assert.equal(existsSync(join(workspace, "sub", "b.txt")), false);

    const applied = store.apply(staged.id);
    assert.equal(applied.state, "applied");
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "改过的 A\n");
    assert.equal(readFileSync(join(workspace, "sub", "b.txt"), "utf8"), "新建的 B\n");
  } finally {
    cleanup();
  }
});

test("写到一半失败时整体还原，不把半套修改留在项目里", () => {
  const { workspace, store, cleanup } = setup();
  try {
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    session.write(join(workspace, "sub", "b.txt"), "写不进去的 B\n");
    const staged = session.finalize();

    // session.write 会先真写进工作区再由 finalize 还原，所以此时 sub 是个空目录。
    // 把它换成普通文件：b.txt 本身仍不存在，冲突检查照过，但 apply 建目录时必然 ENOTDIR。
    // 这比只读位可靠——各平台行为一致。
    rmSync(join(workspace, "sub"), { recursive: true, force: true });
    writeFileSync(join(workspace, "sub"), "我是文件不是目录\n", "utf8");

    assert.throws(() => store.apply(staged.id), /项目已还原到写入前/);

    // 第一个文件必须回到写入前的样子，否则项目里就留下了半套修改。
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "原始 A\n");
    assert.equal(store.get(staged.id)?.state, "failed");
  } finally {
    cleanup();
  }
});

test("已写入的提案可以回滚：改过的文件还原，新建的文件删除", () => {
  const { workspace, store, cleanup } = setup();
  try {
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    session.write(join(workspace, "b.txt"), "新建的 B\n");
    const staged = session.finalize();
    store.apply(staged.id);

    const rolledBack = store.rollback(staged.id);
    assert.equal(rolledBack.state, "rolled_back");
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "原始 A\n");
    assert.equal(existsSync(join(workspace, "b.txt")), false, "新建的文件回滚后应当消失");

    // 回滚过的提案不能再回滚一次。
    assert.throws(() => store.rollback(staged.id), /只有已写入项目的提案可以回滚/);
  } finally {
    cleanup();
  }
});

test("写入之后文件又被改过时，回滚停下来而不是抹掉这些修改", () => {
  const { workspace, store, cleanup } = setup();
  try {
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    const staged = session.finalize();
    store.apply(staged.id);

    // 有人在写入之后又编辑了这个文件。
    writeFileSync(join(workspace, "a.txt"), "别人后来的修改\n", "utf8");

    const result = store.rollback(staged.id);
    assert.equal(result.state, "conflicted");
    assert.deepEqual(result.conflicts, ["a.txt"]);
    // 关键：别人的修改必须原封不动。
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "别人后来的修改\n");
  } finally {
    cleanup();
  }
});

test("提案生成后项目发生变化时不自动覆盖", () => {
  const { workspace, store, cleanup } = setup();
  try {
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    const staged = session.finalize();

    writeFileSync(join(workspace, "a.txt"), "确认之前就被改掉了\n", "utf8");
    const result = store.apply(staged.id);
    assert.equal(result.state, "conflicted");
    assert.deepEqual(result.conflicts, ["a.txt"]);
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "确认之前就被改掉了\n");
  } finally {
    cleanup();
  }
});

test("提案状态跨进程可见：重新打开 store 仍能读到已写入状态", () => {
  const workspace = mkdtempSync(join(tmpdir(), "clownfish-proposal-ws-"));
  const dataDir = mkdtempSync(join(tmpdir(), "clownfish-proposal-data-"));
  try {
    const store = new DevelopmentProposalStore(dataDir);
    writeFileSync(join(workspace, "a.txt"), "原始 A\n", "utf8");
    const session = store.begin(workspace);
    session.write(join(workspace, "a.txt"), "改过的 A\n");
    const staged = session.finalize();
    store.apply(staged.id);

    const reopened = new DevelopmentProposalStore(dataDir);
    assert.equal(reopened.get(staged.id)?.state, "applied");
    // 回滚也能跨进程执行——中断后仍然收得回来。
    assert.equal(reopened.rollback(staged.id).state, "rolled_back");
    assert.equal(readFileSync(join(workspace, "a.txt"), "utf8"), "原始 A\n");
  } finally {
    for (const dir of [workspace, dataDir]) rmSync(dir, { recursive: true, force: true });
  }
});
