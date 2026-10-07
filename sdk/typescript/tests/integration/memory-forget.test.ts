import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { join } from "node:path";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("memory forget requires a fresh preview, records the result and stays forgotten after restart", { timeout: 60_000 }, async () => {
  const app = await startModelHarness();
  const post = async (path: string, body: unknown) => {
    const response = await fetch(app.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const proposal = (await post("/api/personal-work/learning", { kind: "preference", content: "合成测试：仅此来源的紫色纸船", source: {} })).body.record;
    const confirmed = await post("/api/personal-work/decision", { id: proposal.id, revision: proposal.revision, action: "confirm", confirmed: true });
    assert.equal(confirmed.status, 200);
    const memoryId = confirmed.body.record.memoryId;
    const list = async () => (await (await fetch(app.base + "/api/memory?who=me")).json() as any).facts;
    assert.ok((await list()).some((item: any) => item.id === memoryId));
    assert.equal((await post("/api/memory/forget", { id: memoryId })).status, 409);
    assert.equal((await post("/api/memory/forget", { token: "not-a-preview", confirmed: true })).status, 409);
    assert.ok((await list()).some((item: any) => item.id === memoryId));
    const preview = await post("/api/memory/forget/preview", { id: memoryId });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.preview.auto.memories.map((item: any) => item.id), [memoryId]);
    assert.deepEqual(preview.body.preview.auto.learning.map((item: any) => item.id), [proposal.id]);
    assert.equal((await post("/api/memory/forget", { token: preview.body.preview.token })).status, 409);
    assert.ok((await list()).some((item: any) => item.id === memoryId));
    const done = await post("/api/memory/forget", { token: preview.body.preview.token, confirmed: true });
    assert.equal(done.status, 200);
    assert.equal(done.body.receipt.status, "complete");
    assert.ok(done.body.receipt.steps.some((step: any) => step.kind === "memory" && step.status === "success"));
    assert.ok(done.body.receipt.steps.some((step: any) => step.kind === "learning" && step.status === "success"));
    assert.equal((await post("/api/memory/forget", { token: preview.body.preview.token, confirmed: true })).body.receipt.id, done.body.receipt.id);
    assert.ok(!(await list()).some((item: any) => item.id === memoryId));
    const db = new Database(join(app.dir, "companion.db"), { readonly: true });
    try {
      assert.equal((db.prepare("SELECT count(*) AS n FROM procedural_fts WHERE id=?").get(memoryId) as { n: number }).n, 0);
    } finally { db.close(); }
    await app.restart();
    assert.ok(!(await list()).some((item: any) => item.id === memoryId));
    const reopened = new Database(join(app.dir, "companion.db"), { readonly: true });
    try { assert.equal((reopened.prepare("SELECT count(*) AS n FROM procedural_fts WHERE id=?").get(memoryId) as { n: number }).n, 0); }
    finally { reopened.close(); }
    const latest = await (await fetch(app.base + "/api/memory/forget/latest")).json() as any;
    assert.equal(latest.receipt.id, done.body.receipt.id);
    const proposals = (await (await fetch(app.base + "/api/personal-work")).json() as any).proposals;
    const savedProposal = proposals.find((item: any) => item.id === proposal.id);
    assert.equal(savedProposal.state, "revoked");
    assert.equal(savedProposal.content, "");
    assert.equal(savedProposal.source.excerpt, "");

    // A linked matter stays for manual review, so this receipt is partial even
    // after its automatic memory/proposal steps succeed. Replaying its token
    // after an app restart must recover the same audit record without deleting
    // the already-removed memory a second time.
    const matter = (await post("/api/personal-work/matters", { title: "合成待复核事项", goal: "仅用于隔离遗忘恢复测试", nextAction: "保留待人工核对" })).body.record;
    const secondProposal = (await post("/api/personal-work/learning", { kind: "preference", content: "合成测试：仅此来源的绿色纸船", source: { matterId: matter.id } })).body.record;
    const secondConfirmed = await post("/api/personal-work/decision", { id: secondProposal.id, revision: secondProposal.revision, action: "confirm", confirmed: true });
    assert.equal(secondConfirmed.status, 200);
    const secondMemoryId = secondConfirmed.body.record.memoryId;
    const secondPreview = await post("/api/memory/forget/preview", { id: secondMemoryId });
    const secondDone = await post("/api/memory/forget", { token: secondPreview.body.preview.token, confirmed: true });
    assert.equal(secondDone.body.receipt.status, "partial");
    assert.ok(!(await list()).some((item: any) => item.id === secondMemoryId));
    await app.restart();
    const recovered = await post("/api/memory/forget", { token: secondPreview.body.preview.token, confirmed: true });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.receipt.id, secondDone.body.receipt.id);
    assert.equal(recovered.body.receipt.status, "partial");
    assert.equal(recovered.body.receipt.steps.filter((step: any) => step.kind === "memory" && step.id === secondMemoryId && step.status === "success").length, 1);
    assert.deepEqual(recovered.body.receipt.manual, secondDone.body.receipt.manual);
    assert.ok(!(await list()).some((item: any) => item.id === secondMemoryId));
  } finally { await app.stop(); }
});
