import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CapabilityArtifact, CapabilityTask } from "../../examples/companion/capabilities.js";
import { CollaborationLedger, executeCollaboration, makeCollaborationPlan } from "../../examples/companion/collaboration-ledger.js";
import { createCapabilityRoutes } from "../../examples/companion/routes/capabilities.js";
import { AgentJobWorker, FileAgentJobQueue } from "../../src/agent/index.js";

const digest = (body: string): string => createHash("sha256").update(body).digest("hex");
const task = { id: "task-synthetic", title: "合成任务", instruction: "根据本次合成材料研究并提出选择建议", capabilityId: "decision-brief", format: "md" } as CapabilityTask;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-collaboration-"));
  const plan = makeCollaborationPlan(task);
  const ledger = new CollaborationLedger(directory);
  const artifacts = new Map<string, CapabilityArtifact>();
  const taskOrigins = new Map<string, { rootRequestId?: string; actionRunId?: string; invocationId?: string }>();
  let sequence = 0;
  const create = (stepId: string, content = "# 合成成果\n仅用于本地测试。", jobId = "job-test", correlation: { rootRequestId?: string; actionRunId?: string; invocationId?: string } = {}) => {
    const step = plan.steps.find((item) => item.stepId === stepId)!;
    const id = `artifact-${++sequence}`;
    const file = join(directory, `${id}.md`);
    writeFileSync(file, content);
    const artifact = {
      id, file, format: "md", taskId: `subtask-${jobId}-${stepId}`, title: step.title, summary: "合成成果", createdAt: new Date().toISOString(),
      personaId: step.personaId, capabilityId: step.capabilityId,
      metadata: { skillContract: step.contract },
      proof: { version: 1, level: "validated", algorithm: "sha256", contentHash: digest(content), byteLength: Buffer.byteLength(content), checkedAt: new Date().toISOString(),
        checks: ["skill-contract", "skill-content", "skill-format"].map((check) => ({ id: check, label: check, status: "passed", phase: "validation" })) },
    } as CapabilityArtifact;
    artifacts.set(id, artifact);
    taskOrigins.set(artifact.taskId, { ...correlation, invocationId: correlation.invocationId ?? `collaboration-${jobId}-${stepId}` });
    return artifact;
  };
  const findArtifact = (id: string) => artifacts.get(id);
  const artifactBelongsToStep = (artifact: CapabilityArtifact, step: (typeof plan.steps)[number], receipt: { jobId: string; rootRequestId?: string; actionRunId?: string; invocationId?: string }) => {
    const origin = taskOrigins.get(artifact.taskId);
    return artifact.taskId === `subtask-${receipt.jobId}-${step.stepId}` &&
      (!receipt.rootRequestId || origin?.rootRequestId === receipt.rootRequestId) &&
      (!receipt.actionRunId || origin?.actionRunId === receipt.actionRunId) &&
      (!receipt.invocationId || origin?.invocationId === receipt.invocationId);
  };
  return { directory, plan, ledger, artifacts, create, findArtifact, artifactBelongsToStep };
}

test("计划稳定，两步部分失败保存成功原件，重启后只续办失败步骤", async () => {
  const f = fixture();
  try {
    assert.equal(f.plan.steps.length, 2);
    assert.equal(makeCollaborationPlan(task).planHash, f.plan.planHash);
    let firstCalls = 0;
    const first = await executeCollaboration({ plan: f.plan, ledger: f.ledger, jobId: "job-1", findArtifact: f.findArtifact, artifactBelongsToStep: f.artifactBelongsToStep,
      runStep: async (step) => { firstCalls++; if (step.stepId === "expert-2") throw new Error("permission denied"); return f.create(step.stepId, undefined, "job-1"); } });
    assert.equal(firstCalls, 2);
    assert.deepEqual(first.map((item) => item.status), ["succeeded", "failed"]);
    assert.match(first[1]!.receipt?.error || "", /permission denied/);
    const original = first[0]!.receipt!.artifactId!;
    assert.match(readFileSync(f.artifacts.get(original)!.file, "utf8"), /合成成果/);
    const restarted = new CollaborationLedger(f.directory);
    const calls: string[] = [];
    const second = await executeCollaboration({ plan: f.plan, ledger: restarted, jobId: "job-2", findArtifact: f.findArtifact, artifactBelongsToStep: f.artifactBelongsToStep,
      runStep: async (step) => { calls.push(step.stepId); return f.create(step.stepId, undefined, "job-2"); } });
    assert.deepEqual(calls, ["expert-2"]);
    assert.deepEqual(second.map((item) => item.status), ["succeeded", "succeeded"]);
    assert.equal(second[0]!.receipt?.artifactId, original);
    await executeCollaboration({ plan: f.plan, ledger: restarted, jobId: "job-2", findArtifact: f.findArtifact, artifactBelongsToStep: f.artifactBelongsToStep,
      runStep: async () => { throw new Error("duplicate execution"); } });
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("回执顺序不影响按 stepId 汇合；缺 proof、文件变化和显式冲突均不能验收", async () => {
  const f = fixture();
  try {
    for (const step of [...f.plan.steps].reverse()) {
      const artifact = f.create(step.stepId, undefined, "job-reverse");
      f.ledger.append(f.plan, { stepId: step.stepId, jobId: "job-reverse", attempt: 1, status: "running", contractDigest: step.contract.digest });
      f.ledger.append(f.plan, { stepId: step.stepId, jobId: "job-reverse", attempt: 1, status: "succeeded", artifactId: artifact.id,
        artifactContentHash: artifact.proof!.contentHash, proofLevel: artifact.proof!.level, contractDigest: step.contract.digest,
        ...(step.stepId === "expert-2" ? { unresolved: ["冲突：两项判断不一致"] } : {}) });
    }
    assert.deepEqual(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep).map((item) => item.stepId), ["expert-1", "expert-2"]);
    assert.deepEqual(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep).map((item) => item.status), ["succeeded", "unresolved"]);
    const first = f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep)[0]!.receipt!.artifactId!;
    writeFileSync(f.artifacts.get(first)!.file, "tampered");
    assert.equal(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep)[0]!.status, "invalid");
    f.artifacts.get(first)!.proof = undefined;
    assert.equal(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep)[0]!.status, "invalid");
    assert.equal(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep)[1]!.status, "unresolved");
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("中断后的 running 回执待核对，不重跑；无效 proof 传播为失败", async () => {
  const f = fixture();
  try {
    f.ledger.append(f.plan, { stepId: "expert-1", jobId: "job-stopped", attempt: 1, status: "running", contractDigest: f.plan.steps[0]!.contract.digest });
    const calls: string[] = [];
    const result = await executeCollaboration({ plan: f.plan, ledger: new CollaborationLedger(f.directory), jobId: "job-after-restart", findArtifact: f.findArtifact, artifactBelongsToStep: f.artifactBelongsToStep,
      runStep: async (step) => { calls.push(step.stepId); const artifact = f.create(step.stepId, undefined, "job-after-restart"); artifact.proof = undefined; return artifact; } });
    assert.deepEqual(calls, ["expert-2"]);
    assert.deepEqual(result.map((item) => item.status), ["uncertain", "failed"]);
    assert.match(result[1]!.receipt?.error || "", /缺少有效文件/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("跨 job 原件、错 proofLevel 与不在枚举内的回执均不能验收", () => {
  const f = fixture();
  try {
    const step = f.plan.steps[0]!;
    const foreign = f.create(step.stepId, undefined, "job-foreign");
    f.ledger.append(f.plan, { stepId: step.stepId, jobId: "job-current", attempt: 1, status: "running", contractDigest: step.contract.digest });
    f.ledger.append(f.plan, { stepId: step.stepId, jobId: "job-current", attempt: 1, status: "succeeded", artifactId: foreign.id,
      artifactContentHash: foreign.proof!.contentHash, proofLevel: foreign.proof!.level, contractDigest: step.contract.digest });
    assert.equal(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep)[0]!.status, "invalid");

    const other = fixture();
    try {
      const otherStep = other.plan.steps[0]!;
      const artifact = other.create(otherStep.stepId, undefined, "job-proof");
      other.ledger.append(other.plan, { stepId: otherStep.stepId, jobId: "job-proof", attempt: 1, status: "running", contractDigest: otherStep.contract.digest });
      other.ledger.append(other.plan, { stepId: otherStep.stepId, jobId: "job-proof", attempt: 1, status: "succeeded", artifactId: artifact.id,
        artifactContentHash: artifact.proof!.contentHash, proofLevel: "produced", contractDigest: otherStep.contract.digest });
      assert.equal(other.ledger.view(other.plan, other.findArtifact, other.artifactBelongsToStep)[0]!.status, "invalid");
    } finally { rmSync(other.directory, { recursive: true, force: true }); }

    const file = join(f.directory, readdirSync(f.directory).find((name) => name.endsWith(".jsonl"))!);
    writeFileSync(file, JSON.stringify({ version: 1, planHash: f.plan.planHash, stepId: step.stepId, jobId: "job-tampered", attempt: 1, status: "mystery", at: new Date().toISOString(), contractDigest: step.contract.digest }));
    assert.throws(() => f.ledger.read(f.plan), /回执损坏/);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("request、action、job 与逐步 invocation 关联写入回执和原始成果归属", async () => {
  const f = fixture();
  try {
    const jobId = "job-correlated";
    const rootRequestId = "request-synthetic-01";
    const actionRunId = "collaboration-action:server-synthetic-01";
    const result = await executeCollaboration({
      plan: f.plan, jobId, rootRequestId, actionRunId, ledger: f.ledger, findArtifact: f.findArtifact,
      artifactBelongsToStep: f.artifactBelongsToStep,
      runStep: async (step) => {
        const invocationId = `collaboration-${jobId}-${step.stepId}`;
        return f.create(step.stepId, undefined, jobId, { rootRequestId, actionRunId, invocationId });
      },
    });
    assert.deepEqual(result.map((step) => step.status), ["succeeded", "succeeded"]);
    for (const step of result) {
      assert.equal(step.receipt?.jobId, jobId);
      assert.equal(step.receipt?.rootRequestId, rootRequestId);
      assert.equal(step.receipt?.actionRunId, actionRunId);
      assert.equal(step.receipt?.invocationId, `collaboration-${jobId}-${step.stepId}`);
    }
    const persisted = new CollaborationLedger(f.directory).read(f.plan);
    assert.equal(persisted.length, 4);
    assert.ok(persisted.every((receipt) => receipt.rootRequestId === rootRequestId && receipt.actionRunId === actionRunId));
    assert.equal(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep).every((step) => step.status === "succeeded"), true);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});

test("协作 POST 首次与重复响应回传持久关联，旧 job 不伪造缺失 ID", async () => {
  const directory = mkdtempSync(join(tmpdir(), "clownfish-collaboration-route-"));
  try {
    const plan = makeCollaborationPlan(task);
    const queue = new FileAgentJobQueue(join(directory, "jobs.json"));
    let requestBody = { id: task.id, planHash: plan.planHash, requestId: "request-route-synthetic-01" };
    let actionCalls = 0;
    const responses: Array<{ status: number; body: any }> = [];
    const deps: any = {
      USER: "synthetic-user", agentJobQueue: queue,
      agentUserActions: { execute: async (input: any) => {
        actionCalls++;
        return { value: await input.execute(), runId: input.runId };
      } },
      capabilities: {
        snapshot: () => ({ tasks: [task], artifacts: [] }),
        projectTaskExecution: () => {}, updateTaskStoryline: () => {}, artifactHandoff: () => undefined,
      },
      collaborationLedger: { read: () => [], view: () => [] },
      readBody: async () => requestBody,
      send: (_res: unknown, status: number, body: unknown) => { responses.push({ status, body }); },
      teamConnectionFingerprint: () => "synthetic-fingerprint",
    };
    const entry = createCapabilityRoutes(deps).find((item) => item.path === "/api/capabilities/task/collaborate")!;
    const invoke = async () => entry.handler({
      req: {} as any, res: {} as any, url: entry.path, pathname: entry.path, query: new URLSearchParams(),
    }, undefined);

    await invoke();
    const first = responses.at(-1)!.body;
    assert.equal(responses.at(-1)!.status, 202);
    assert.equal(first.repeated, undefined);
    assert.equal(first.rootRequestId, requestBody.requestId);
    assert.equal(first.auditRunId, first.job.metadata.actionRunId);
    assert.equal(first.job.metadata.rootRequestId, requestBody.requestId);

    await invoke();
    const repeated = responses.at(-1)!.body;
    assert.equal(responses.at(-1)!.status, 202);
    assert.equal(repeated.repeated, true);
    assert.equal(repeated.job.id, first.job.id);
    assert.equal(repeated.rootRequestId, first.job.metadata.rootRequestId);
    assert.equal(repeated.auditRunId, first.job.metadata.actionRunId);
    assert.equal(actionCalls, 1);

    const legacyQueue = new FileAgentJobQueue(join(directory, "legacy-jobs.json"));
    const legacyJob = legacyQueue.enqueue({ type: "orchestration", payload: { collaborationPlan: plan, taskId: task.id },
      idempotencyKey: `collaboration:${task.id}:${plan.planHash}:${requestBody.requestId}` });
    const legacyDeps = { ...deps, agentJobQueue: legacyQueue };
    const legacyEntry = createCapabilityRoutes(legacyDeps).find((item) => item.path === "/api/capabilities/task/collaborate")!;
    const legacyInvoke = async () => legacyEntry.handler({
      req: {} as any, res: {} as any, url: legacyEntry.path, pathname: legacyEntry.path, query: new URLSearchParams(),
    }, undefined);
    await legacyInvoke();
    const legacy = responses.at(-1)!.body;
    assert.equal(legacy.job.id, legacyJob.id);
    assert.equal(legacy.repeated, true);
    assert.equal(legacy.rootRequestId, undefined);
    assert.equal(legacy.auditRunId, undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("partial collaboration remains non-complete at the durable job boundary", async () => {
  const f = fixture();
  try {
    const queueFile = join(f.directory, "jobs.json");
    const queue = new FileAgentJobQueue(queueFile);
    const job = queue.enqueue({ type: "collaboration", payload: {}, idempotencyKey: "collaboration:partial-synthetic", sideEffectRisk: true });
    const worker = new AgentJobWorker(queue, {
      collaboration: async (record) => {
        const steps = await executeCollaboration({
          plan: f.plan, jobId: record.id, rootRequestId: "request-partial-synthetic", actionRunId: "collaboration-action:partial-synthetic",
          ledger: f.ledger, findArtifact: f.findArtifact, artifactBelongsToStep: f.artifactBelongsToStep,
          runStep: async (step) => {
            if (step.stepId === "expert-2") throw new Error("synthetic second-step failure");
            return f.create(step.stepId, undefined, record.id, {
              rootRequestId: "request-partial-synthetic", actionRunId: "collaboration-action:partial-synthetic",
            });
          },
        });
        if (steps.some((step) => step.status !== "succeeded")) throw new Error("partial collaboration is not complete");
        return { summary: "all steps succeeded", data: { steps: steps.length } };
      },
    }, { workerId: "collaboration-synthetic-worker" });
    const settled = await worker.runOnce();
    assert.equal(settled?.id, job.id);
    assert.equal(settled?.status, "uncertain");
    assert.notEqual(settled?.disposition?.state, "completed");
    assert.deepEqual(f.ledger.view(f.plan, f.findArtifact, f.artifactBelongsToStep).map((step) => step.status), ["succeeded", "failed"]);
  } finally { rmSync(f.directory, { recursive: true, force: true }); }
});
