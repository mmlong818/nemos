import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningTaskSteeringStore } from "../../examples/companion/running-task-steering.js";

test("running task messages are durable, ordered, user-scoped, and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-steering-"));
  const file = join(dir, "steering.json");
  try {
    const store = new RunningTaskSteeringStore(file);
    const first = store.append({ id: "client-1", jobId: "job-1", userId: "one", mode: "merge", text: "add S2" });
    assert.equal(first.revision, 1);
    assert.deepEqual(store.append({ id: "client-1", jobId: "job-1", userId: "one", mode: "merge", text: "add S2" }), first);
    assert.equal(store.append({ jobId: "job-1", userId: "one", mode: "redirect", text: "use the new goal" }).revision, 2);
    store.append({ jobId: "job-1", userId: "two", mode: "merge", text: "private to another user" });
    assert.deepEqual(new RunningTaskSteeringStore(file).snapshot("job-1", "one").map((item) => item.revision), [1, 2]);
    assert.equal(store.snapshot("job-1", "two").length, 1);
    assert.throws(() => store.append({ id: "client-1", jobId: "job-1", userId: "one", mode: "redirect", text: "changed" }), /content has changed|\u5185\u5bb9\u5df2\u6539\u53d8/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("damaged persisted inbox does not grant or invent task input", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-steering-bad-"));
  const file = join(dir, "steering.json");
  try {
    writeFileSync(file, "{not json", "utf8");
    const store = new RunningTaskSteeringStore(file);
    assert.deepEqual(store.snapshot("job", "user"), []);
    assert.throws(() => store.append({ jobId: "job", userId: "user", mode: "merge", text: " ".repeat(2) }), /invalid|\u65e0\u6548/);
    assert.throws(() => store.append({ jobId: "job", userId: "user", mode: "merge", text: "x".repeat(4001) }), /4000/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("accept atomically rejects terminal/final-stage messages and records queued redirects", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemos-steering-gate-"));
  const file = join(dir, "steering.json");
  try {
    const store = new RunningTaskSteeringStore(file);
    const input = { id: "redirect-queued", jobId: "job", userId: "user", mode: "redirect" as const, text: "new goal" };
    const accepted = store.accept(input, { status: "queued" });
    assert.equal(accepted.effective, "执行开始时生效");
    assert.equal(store.snapshot("job", "user").length, 1);
    assert.throws(() => store.accept({ ...input, id: "too-late" }, { status: "running", stage: { id: "final", state: "received" } }), /未记录/);
    assert.throws(() => store.accept({ ...input, id: "verified-gap" }, { status: "running", stage: { id: "final", state: "verified" } }), /未记录/);
    assert.throws(() => store.accept({ ...input, id: "done" }, { status: "succeeded" }), /已结束/);
    assert.equal(store.snapshot("job", "user").length, 1, "rejected messages never reach durable task input");
    const during = store.accept({ ...input, id: "running", mode: "merge" }, { status: "running", stage: { id: "work:one", name: "Worker" } });
    assert.match(during.effective, /尝试纳入/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
