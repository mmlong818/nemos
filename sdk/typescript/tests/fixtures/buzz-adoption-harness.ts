import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FileAgentJobQueue } from "../../src/agent/job-queue.js";
import { FileAgentApprovalStore } from "../../src/agent/approval-store.js";
import { startModelHarness } from "./companion-model-harness.js";

/** Synthetic records only. No real tool or model call is needed for this fixture. */
export async function startBuzzHarness() {
  const app = await startModelHarness();
  const abort = new AbortController();
  try {
    writeFileSync(join(app.dir, "counterparts.json"), "{QA-corrupted-memory");
    const jobs = new FileAgentJobQueue(join(app.dir, "agent-jobs.json"));
    const uncertain = jobs.enqueue({ type: "qa-only", payload: { title: "发送周报：请核对是否已送达" }, maxAttempts: 1, sideEffectRisk: true });
    jobs.claimNext("fixture"); jobs.fail(uncertain.id, "fixture", "synthetic interrupted external action");
    const failed = jobs.enqueue({ type: "qa-only", payload: { title: "整理阅读资料" }, maxAttempts: 1 });
    jobs.claimNext("fixture"); jobs.fail(failed.id, "fixture", "synthetic failure");
    const approvals = new FileAgentApprovalStore(join(app.dir, "agent-approvals.json"));
    void approvals.authorize({ runId: "qa-approval-run", sessionId: "qa-session", signal: abort.signal,
      call: { id: "qa-write", name: "save_report", arguments: { path: "QA-report.txt", text: "合成测试，不会真正写入" } },
      tool: { name: "save_report", description: "保存本次周报", inputSchema: { type: "object" }, effect: "write" } });
    const approvalId = approvals.list({ status: "pending" })[0].id;
    await app.restart();
    return { ...app, uncertainId: uncertain.id, failedId: failed.id, approvalId,
      stop: async () => { abort.abort(); await app.stop(); } };
  } catch (error) { abort.abort(); await app.stop(); throw error; }
}

if (require.main === module) {
  void startBuzzHarness().then((app) => {
    console.log(JSON.stringify({ base: app.base, dir: app.dir, uncertainId: app.uncertainId, approvalId: app.approvalId }));
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data) => {
      const command = String(data).trim();
      if (command === "restart") void app.restart().then(() => console.log("QA_RESTARTED"));
      if (command === "stop") void app.stop().then(() => process.exit(0));
    });
  });
}
