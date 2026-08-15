import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DevelopmentProposalStore } from "../../examples/companion/development-proposals.js";

function fixture(): { root: string; workspace: string; dataDir: string } {
  const root = mkdtempSync(join(tmpdir(), "clownfish-development-proposal-"));
  const workspace = join(root, "workspace");
  const dataDir = join(root, "data");
  mkdirSync(workspace, { recursive: true });
  return { root, workspace, dataDir };
}

test("开发修改先恢复工作区，确认后才正式写入", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "index.ts");
  writeFileSync(target, "export const value = 1;\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace, "base-revision");
    session.write(target, "export const value = 2;\n");
    const proposal = session.finalize();

    assert.equal(proposal.state, "pending");
    assert.equal(readFileSync(target, "utf8"), "export const value = 1;\n");
    assert.equal(proposal.files[0]?.path, "index.ts");

    const reloaded = new DevelopmentProposalStore(dataDir);
    assert.equal(reloaded.get(proposal.id)?.state, "pending");
    assert.equal(reloaded.apply(proposal.id).state, "applied");
    assert.equal(readFileSync(target, "utf8"), "export const value = 2;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("放弃新文件提案不会留下文件", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "new-file.ts");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace);
    session.write(target, "export {};\n");
    const proposal = session.finalize();

    assert.equal(existsSync(target), false);
    assert.equal(store.reject(proposal.id).state, "rejected");
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("项目在确认前变化时拒绝覆盖", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "index.ts");
  writeFileSync(target, "original\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace);
    session.write(target, "proposal\n");
    const proposal = session.finalize();
    writeFileSync(target, "newer user edit\n", "utf8");

    const result = store.apply(proposal.id);
    assert.equal(result.state, "conflicted");
    assert.deepEqual(result.conflicts, ["index.ts"]);
    assert.equal(readFileSync(target, "utf8"), "newer user edit\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("重启时恢复中断开发留下的原文件", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "index.ts");
  writeFileSync(target, "safe\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace);
    session.write(target, "interrupted\n");

    const recovered = new DevelopmentProposalStore(dataDir);
    assert.equal(readFileSync(target, "utf8"), "safe\n");
    assert.equal(recovered.get(session.proposal.id)?.state, "failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("服务启动可只读取中断提案而不自动改动用户项目", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "index.ts");
  writeFileSync(target, "safe\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace);
    session.write(target, "interrupted\n");

    const reopened = new DevelopmentProposalStore(dataDir, { recoverInterrupted: false });
    assert.equal(readFileSync(target, "utf8"), "interrupted\n");
    assert.equal(reopened.get(session.proposal.id)?.state, "staging");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("开发执行期间的用户修改不会被恢复动作覆盖", () => {
  const { root, workspace, dataDir } = fixture();
  const target = join(workspace, "index.ts");
  writeFileSync(target, "base\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace);
    session.write(target, "agent edit\n");
    writeFileSync(target, "user edit\n", "utf8");

    assert.throws(() => session.finalize(), /其他修改/);
    assert.equal(readFileSync(target, "utf8"), "user edit\n");
    assert.equal(store.get(session.proposal.id)?.state, "conflicted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("隔离工作区生成的提案以原项目内容作为写入基线", () => {
  const { root, workspace, dataDir } = fixture();
  const isolated = join(root, "isolated");
  mkdirSync(isolated, { recursive: true });
  writeFileSync(join(workspace, "index.ts"), "original\n", "utf8");
  writeFileSync(join(isolated, "index.ts"), "original\n", "utf8");
  try {
    const store = new DevelopmentProposalStore(dataDir);
    const session = store.begin(workspace, "base", isolated);
    session.write(join(isolated, "index.ts"), "proposal from isolated workspace\n");
    const proposal = session.finalize();
    assert.equal(readFileSync(join(workspace, "index.ts"), "utf8"), "original\n");
    assert.equal(readFileSync(join(isolated, "index.ts"), "utf8"), "original\n");
    store.apply(proposal.id);
    assert.equal(readFileSync(join(workspace, "index.ts"), "utf8"), "proposal from isolated workspace\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
