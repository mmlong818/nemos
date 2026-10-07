import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Memory, Nemos } from "../../src/index.js";
import Database from "better-sqlite3";
import type { PersonalWorkStore } from "./personal-work.js";

const LAYERS = ["personal_semantic", "semantic", "episodic", "procedural"] as const;
const TTL_MS = 2 * 60_000;
type Step = { kind: "memory" | "index" | "queue" | "learning"; id: string; status: "success" | "failed" | "manual"; reason?: string };
export type ForgetReceipt = { id: string; at: string; targetId: string; status: "complete" | "partial"; steps: Step[]; manual: Array<{ kind: string; id: string; reason: string }> };
type Plan = {
  targetId: string;
  memories: Memory[];
  queue: Array<{ id: string; archival_id: string; status: string }>;
  learning: Array<{ id: string; memoryId: string; revision: number; state: string; source: { matterId: string; taskId: string; artifactId: string } }>;
  manual: Array<{ kind: string; id: string; reason: string }>;
  fingerprint: string;
};
type Preview = { plan: Plan; expiresAt: number };
type PlanMemory = { id: string; layer: string; scope: string; archival_ref?: string; fingerprint: string };
type DurablePlan = {
  version: 1;
  user: string;
  targetId: string;
  expiresAt: number;
  memories: PlanMemory[];
  queue: Plan["queue"];
  learning: Plan["learning"];
  manual: Plan["manual"];
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const memoryFingerprint = (item: Memory, token: string) => createHmac("sha256", token).update(JSON.stringify([item.id, item.layer, item.scope, item.archival_ref, item.content, item.source, item.source_event_ids, item.evidence_count])).digest("hex");

/** Application-level two-step deletion. The SDK owns its memory and search-index transaction. */
export class MemoryForgetCoordinator {
  private readonly previews = new Map<string, Preview>();
  private readonly pending = new Map<string, Promise<ForgetReceipt>>();
  private readonly receipts: Record<string, ForgetReceipt>;
  private readonly plans: Record<string, DurablePlan>;
  constructor(private readonly file: string, private readonly dbPath: string, private readonly memory: () => Nemos, private readonly work: PersonalWorkStore, private readonly user: string) {
    try { this.receipts = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as Record<string, ForgetReceipt> : {}; }
    catch { throw new Error("遗忘回执无法读取；请先修复本地记录，再执行删除"); }
    try { this.plans = existsSync(`${file}.plans`) ? JSON.parse(readFileSync(`${file}.plans`, "utf8")) as Record<string, DurablePlan> : {}; }
    catch { throw new Error("遗忘恢复记录无法读取；请先修复本地记录，再执行删除"); }
  }
  latest(): ForgetReceipt | null { return Object.values(this.receipts).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null; }
  private save(key: string, receipt: ForgetReceipt) {
    this.receipts[key] = receipt;
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.receipts), { encoding: "utf8" });
    renameSync(temp, this.file);
  }
  private savePlans() {
    const file = `${this.file}.plans`;
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.plans), { encoding: "utf8" });
    renameSync(temp, file);
  }
  private async plan(targetId: string): Promise<Plan> {
    const mem = this.memory();
    const store = mem.forUser(this.user);
    const all = (await Promise.all(LAYERS.map((layer) => store.listByLayer(layer, { limit: 100000 })))).flat();
    const target = all.find((item) => item.id === targetId);
    if (!target) throw Object.assign(new Error("记忆已不存在或不属于当前用户；请刷新列表"), { status: 404 });
    // A shared archival reference plus the same scope is a provable source chain.
    // Independently supported records are withheld for manual review.
    const peers = target.archival_ref ? all.filter((item) => item.id !== target.id && item.archival_ref === target.archival_ref && item.scope === target.scope) : [];
    const safe = peers.filter((item) => (item.source_event_ids?.length ?? 0) <= 1 && (item.evidence_count ?? 1) <= 1);
    const uncertain = peers.filter((item) => !safe.includes(item));
    const memories = [target, ...safe];
    const manual = uncertain.map((item) => ({ kind: "memory", id: item.id, reason: "这条记录还有其它来源证据，需人工复核" }));
    const sourceKey = target.source.source_message_id && target.source.conversation_id;
    if (sourceKey) for (const item of all) {
      if (memories.includes(item) || uncertain.includes(item)) continue;
      if (item.source.source_message_id === target.source.source_message_id && item.source.conversation_id === target.source.conversation_id) {
        manual.push({ kind: "memory", id: item.id, reason: "同一消息标识，但来源链未证实" });
      }
    }
    const archivalIds = new Set(memories.map((item) => item.archival_ref).filter((id): id is string => !!id));
    const queue = mem.raw().storage.listPendingByUser("default", this.user)
      .filter((item) => archivalIds.has(item.archival_id))
      .map((item) => ({ id: item.id, archival_id: item.archival_id, status: item.status }));
    for (const item of queue.filter((item) => item.status === "analyzing")) manual.push({ kind: "queue", id: item.id, reason: "后台抽取正在运行；请待其结束后重新预览" });
    const linkedIds = new Set(memories.map((item) => item.id));
    const learning = this.work.proposals(this.user).filter((item) => item.memoryId && linkedIds.has(item.memoryId) && ["confirmed", "revoking"].includes(item.state))
      .map((item) => ({ id: item.id, memoryId: item.memoryId!, revision: item.revision, state: item.state, source: { matterId: item.source.matterId, taskId: item.source.taskId, artifactId: item.source.artifactId } }));
    for (const item of learning) for (const [kind, id] of Object.entries(item.source)) if (id) manual.push({ kind, id, reason: "关联记录可能包含副本；需要逐项核对" });
    if (target.archival_ref) manual.push({ kind: "archival", id: target.archival_ref, reason: "原始归档受内核保护；后续整合可能再次生成相关记忆" });
    const snapshot = {
      memories: memories.map((item) => [item.id, item.layer, item.scope, item.archival_ref, item.content, item.source, item.source_event_ids, item.evidence_count]),
      queue, learning, manual,
    };
    return { targetId, memories, queue, learning, manual, fingerprint: digest(snapshot) };
  }
  async preview(id: string) {
    const plan = await this.plan(id);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + TTL_MS;
    const key = digest(token);
    this.previews.set(key, { plan, expiresAt });
    return {
      token, expiresAt: new Date(expiresAt).toISOString(), targetId: id,
      canConfirm: !plan.queue.some((item) => item.status === "analyzing"),
      auto: { memories: plan.memories.map((item) => ({ id: item.id, layer: item.layer, scope: item.scope, source: item.id === id ? "选中的记忆" : "同一归档来源链" })), queue: plan.queue.filter((item) => item.status !== "analyzing").map((item) => ({ id: item.id, source: item.archival_id })), learning: plan.learning.map((item) => ({ id: item.id, memoryId: item.memoryId })) },
      manual: plan.manual,
      note: "原始聊天与归档保留；删除后不能保证未来模型不会从保留材料再次得出相似内容。",
    };
  }
  async confirm(token: string, confirmed: boolean): Promise<ForgetReceipt> {
    if (!confirmed || !token) throw Object.assign(new Error("请先查看影响预览，再明确确认"), { status: 409 });
    const key = digest(token);
    if (this.receipts[key]?.status === "complete") return this.receipts[key]!;
    const running = this.pending.get(key);
    if (running) return running;
    const operation = this.execute(key, token);
    this.pending.set(key, operation);
    try { return await operation; } finally { this.pending.delete(key); }
  }
  private async execute(key: string, token: string): Promise<ForgetReceipt> {
    const preview = this.previews.get(key);
    const prior = this.receipts[key];
    let durable = this.plans[key];
    if ((!preview && (!prior || !durable)) || ((preview?.expiresAt ?? durable?.expiresAt ?? 0) < Date.now())) throw Object.assign(new Error("预览已过期或恢复记录不可用，请重新查看影响范围"), { status: 409 });
    if (durable && (durable.version !== 1 || durable.user !== this.user)) throw Object.assign(new Error("恢复记录版本或用户范围不匹配，请重新预览"), { status: 409 });
    const basePlan = preview?.plan;
    let fresh: Plan;
    if (!prior) {
      fresh = await this.plan(basePlan!.targetId);
      if (fresh.fingerprint !== basePlan!.fingerprint) throw Object.assign(new Error("记忆或关联记录已变化，请重新预览"), { status: 409 });
      durable = {
        version: 1, user: this.user, targetId: fresh.targetId, expiresAt: preview!.expiresAt,
        memories: fresh.memories.map((item) => ({ id: item.id, layer: item.layer, scope: item.scope, archival_ref: item.archival_ref, fingerprint: memoryFingerprint(item, token) })),
        queue: fresh.queue, learning: fresh.learning, manual: fresh.manual,
      };
      this.plans[key] = durable;
      this.savePlans();
    } else {
      // Resume only the exact previewed batch. Successful steps are retained in
      // the durable receipt; remaining records must still match that snapshot.
      const mem = this.memory();
      const all = (await Promise.all(LAYERS.map((layer) => mem.forUser(this.user).listByLayer(layer, { limit: 100000 })))).flat();
      const succeeded = (kind: Step["kind"], id: string) => prior.steps.some((step) => step.kind === kind && step.id === id && step.status === "success");
      const manual = [...prior.manual];
      const memories: Memory[] = [];
      const expectedMemories: PlanMemory[] = durable?.memories ?? basePlan!.memories.map((item) => ({ id: item.id, layer: item.layer, scope: item.scope, archival_ref: item.archival_ref, fingerprint: memoryFingerprint(item, token) }));
      for (const expected of expectedMemories) {
        if (succeeded("memory", expected.id)) continue;
        const current = all.find((item) => item.id === expected.id);
        if (!current) {
          // A crash may occur after the SDK transaction but before its receipt
          // step is flushed. Absence means deletion already committed; do not
          // issue another delete.
          prior.steps.push({ kind: "memory", id: expected.id, status: "success" });
          prior.steps.push({ kind: "index", id: expected.id, status: "success" });
          continue;
        }
        if (memoryFingerprint(current, token) !== expected.fingerprint) {
          manual.push({ kind: "memory", id: expected.id, reason: "预览后记录已变化，未继续删除；请重新核对" });
          continue;
        }
        memories.push(current);
      }
      const originalIds = new Set(expectedMemories.map((item) => item.id));
      const anchor = expectedMemories[0];
      if (anchor?.archival_ref) for (const item of all) {
        if (!originalIds.has(item.id) && item.archival_ref === anchor.archival_ref && item.scope === anchor.scope) {
          manual.push({ kind: "memory", id: item.id, reason: "预览后出现同归档派生记录，需人工复核" });
        }
      }
      const queueNow = mem.raw().storage.listPendingByUser("default", this.user);
      const expectedQueue = durable?.queue ?? basePlan!.queue;
      const queue = expectedQueue.flatMap((item) => {
        if (succeeded("queue", item.id)) return [];
        const current = queueNow.find((row) => row.id === item.id);
        if (!current) {
          const row = mem.raw().storage.getQueueRow(item.id);
          if (row?.archival_id === item.archival_id && row.status === "completed") {
            manual.push({ kind: "queue", id: item.id, reason: "后台抽取已完成，可能产生新记忆；需人工复核" });
            prior.steps.push({ kind: "queue", id: item.id, status: "manual", reason: "后台抽取已完成" });
          } else {
            prior.steps.push({ kind: "queue", id: item.id, status: "success" });
          }
          return [];
        }
        if (current.archival_id !== item.archival_id || !["queued", "failed", "analyzing"].includes(current.status)) {
          manual.push({ kind: "queue", id: item.id, reason: "队列状态已变化，未继续处理；请人工复核" });
          return [];
        }
        return [{ ...item, status: current.status }];
      });
      const currentLearning = this.work.proposals(this.user);
      const learning = (durable?.learning ?? basePlan!.learning).flatMap((item) => {
        if (succeeded("learning", item.id)) return [];
        const current = currentLearning.find((proposal) => proposal.id === item.id);
        if (!current) {
          prior.steps.push({ kind: "learning", id: item.id, status: "success" });
          return [];
        }
        if (current.revision !== item.revision || current.state !== item.state || current.memoryId !== item.memoryId) {
          manual.push({ kind: "learning", id: item.id, reason: "学习提议已变化，未继续处理；请人工复核" });
          return [];
        }
        return [item];
      });
      fresh = { targetId: durable?.targetId ?? basePlan!.targetId, memories, queue, learning, manual, fingerprint: "resume" };
      prior.status = "partial";
      prior.manual = manual;
      this.save(key, prior);
    }
    if (fresh.queue.some((item) => item.status === "analyzing")) throw Object.assign(new Error("关联抽取正在运行，请稍后重新预览"), { status: 409 });
    const receipt: ForgetReceipt = prior ?? { id: randomBytes(12).toString("hex"), at: new Date().toISOString(), targetId: fresh.targetId, status: "partial", steps: [], manual: fresh.manual };
    const record = (finished = false) => {
      const latest = new Map<string, Step>();
      for (const step of receipt.steps) latest.set(`${step.kind}:${step.id}`, step);
      receipt.status = finished && [...latest.values()].every((step) => step.status === "success") && !receipt.manual.length ? "complete" : "partial";
      this.save(key, receipt);
    };
    // Persist the partial receipt before the first destructive step so a crash
    // between the SDK transaction and its per-step receipt can be recovered.
    record();
    // Stop queued source extraction first, before deleting any derived item.
    for (const item of fresh.queue) {
      try {
        // Conditional SQL closes the race with the SDK worker's queued -> analyzing claim.
        const db = new Database(this.dbPath);
        try {
          const at = new Date().toISOString();
          const result = db.prepare("UPDATE ingest_queue SET status='completed', updated_at=?, completed_at=? WHERE id=? AND tenant_id='default' AND user_id=? AND archival_id=? AND status IN ('queued','failed')")
            .run(at, at, item.id, this.user, item.archival_id);
          if (result.changes !== 1) throw new Error("后台任务状态变化");
        } finally { db.close(); }
        const after = this.memory().raw().storage.getQueueRow(item.id);
        if (after?.status !== "completed") throw new Error("状态未停用");
        receipt.steps.push({ kind: "queue", id: item.id, status: "success" });
      } catch { receipt.steps.push({ kind: "queue", id: item.id, status: "failed", reason: "后台任务停用失败" }); }
      record();
    }
    if (receipt.steps.some((step) => step.kind === "queue" && step.status === "failed")) {
      for (const item of fresh.memories) {
        receipt.steps.push({ kind: "memory", id: item.id, status: "manual", reason: "关联后台抽取未停用，暂缓删除" });
        receipt.steps.push({ kind: "index", id: item.id, status: "manual", reason: "记忆未删除，索引保持原状" });
      }
      for (const item of fresh.learning) receipt.steps.push({ kind: "learning", id: item.id, status: "manual", reason: "记忆未删除，学习提议保持原状" });
      record();
      return receipt;
    }
    for (const item of fresh.memories) {
      try {
        await this.memory().forUser(this.user).forget(item.id);
        receipt.steps.push({ kind: "memory", id: item.id, status: "success" });
        const exists = this.memory().raw().storage.findById("default", this.user, item.id);
        if (exists) throw new Error("索引验证前记录仍存在");
        // SDK delete removes FTS, vector, entity and claim indexes in one transaction.
        receipt.steps.push({ kind: "index", id: item.id, status: "success" });
      } catch {
        if (!receipt.steps.some((step) => step.kind === "memory" && step.id === item.id)) receipt.steps.push({ kind: "memory", id: item.id, status: "failed", reason: "删除失败" });
        receipt.steps.push({ kind: "index", id: item.id, status: "failed", reason: "无法确认索引已清理" });
      }
      record();
    }
    for (const item of fresh.learning) {
      if (!receipt.steps.some((step) => step.kind === "memory" && step.id === item.memoryId && step.status === "success")) {
        receipt.steps.push({ kind: "learning", id: item.id, status: "manual", reason: "关联记忆未删除" }); record(); continue;
      }
      try { this.work.revokeForgottenMemory(this.user, item.memoryId); receipt.steps.push({ kind: "learning", id: item.id, status: "success" }); }
      catch { receipt.steps.push({ kind: "learning", id: item.id, status: "failed", reason: "学习提议未停用" }); }
      record();
    }
    record(true);
    if (receipt.status === "complete") {
      this.previews.delete(key);
      delete this.plans[key];
      this.savePlans();
    }
    return receipt;
  }
}
