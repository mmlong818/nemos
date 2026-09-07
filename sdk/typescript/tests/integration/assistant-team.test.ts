import assert from "node:assert/strict";
import test from "node:test";
import { startModelHarness } from "../fixtures/companion-model-harness.js";

test("助理团队 HTTP：配置、实际队列执行、自动收尾、回执恢复、取消与重启", { timeout: 90000 }, async () => {
  const h = await startModelHarness();
  const request = async (path: string, body?: unknown, expected = 200) => {
    const r = await fetch(h.base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json() as any; assert.equal(r.status, expected, JSON.stringify(data)); return data;
  };
  const team = (path = "", body?: unknown, expected = 200) => request("/api/assistant-team" + path, body, expected);
  const payload = { requestId: "http-team", objective: "QA-TEAM 合成资料整理", materials: "[S1] 日期10月6日", requiredFields: ["日期"], workerIds: ["bot-organizer"], reviewerId: "bot-reviewer" };
  const waitJob = async (id: string, states: string[]) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { const { job } = await team("/job?id=" + id); if (states.includes(job.status)) return job; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error("job did not reach " + states.join(","));
  };
  try {
    assert.equal((await fetch(h.base + "/bots")).status, 200);
    assert.equal((await team()).bots.length, 2);
    await team("/start", payload, 409); // never claim offline echo is execution
    await request("/api/llm-config", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual" });
    let badFinal = false;
    h.state.replyFor = (body) => body.messages?.[0]?.content.includes("最终交付协议")
      ? JSON.stringify({ summary: "合成简报", fields: badFinal ? [] : [{ label: "日期", value: "10月6日", sources: ["S1"] }] }) : "[S1] 合成资料已核对";
    const custom = await team("/bot", { name: "QA 自定义 Bot", role: "worker", instructions: "只整理当前材料", enabled: true, userId: "forged" });
    await team("/bot", { ...custom.record, revision: 0 }, 409);
    const id = (await team("/start", payload, 202)).record.id;
    assert.equal((await team("/start", payload, 202)).record.id, id);
    await team("/start", { ...payload, materials: "changed" }, 409);
    const success = await waitJob(id, ["succeeded", "failed"]);
    assert.equal(success.status, "succeeded", success.error); assert.equal(success.result.data.receipts.length, 3);
    assert.equal(success.result.data.delivery.fields[0].value, "10月6日");
    assert.equal(success.payload.connectionFingerprint, undefined);
    const summary = (await team()).jobs.find((job: any) => job.id === id);
    assert.equal(summary.status, "succeeded");
    assert.equal(summary.modelAdmission, undefined, "终态不得保留等待模型标签");
    const exported = await fetch(h.base + "/api/assistant-team/export?id=" + id);
    assert.equal(exported.status, 200); assert.match(exported.headers.get("Content-Type")!, /^text\/plain/);
    assert.match(exported.headers.get("Content-Disposition")!, /^attachment;/);
    assert.equal(exported.headers.get("Cache-Control"), "no-store"); assert.equal(exported.headers.get("X-Content-Type-Options"), "nosniff");
    const exportedText = await exported.text(); assert.match(exportedText, /10月6日\n来源：S1/);
    assert.match(exportedText, /不代表事实正确/); assert.doesNotMatch(exportedText, /connectionFingerprint|instructions|requestId/);
    const calls = h.requests.filter((r) => r.body?.messages?.some((m: any) => String(m.content).includes("QA-TEAM")));
    assert.equal(calls.length, 3); assert.ok(calls.every((r) => !r.body.tools && r.body.model === "manual"));
    await team("/retry", { id }, 409);
    badFinal = true;
    const failedId = (await team("/start", { ...payload, requestId: "bad-final" }, 202)).record.id;
    assert.equal((await waitJob(failedId, ["failed"])).result, undefined);
    badFinal = false; const before = h.requests.length;
    await team("/retry", { id: failedId }); assert.equal((await waitJob(failedId, ["succeeded", "failed"])).status, "succeeded");
    assert.equal(h.requests.length - before, 1); // only final, not the specialists
    await h.restart();
    assert.equal((await team()).bots.find((b: any) => b.id === custom.record.id).instructions, "只整理当前材料");
    assert.equal((await team("/job?id=" + id)).job.result.data.receipts.length, 3);
    h.state.delayMs = 800;
    const cancelId = (await team("/start", { ...payload, requestId: "cancel" }, 202)).record.id;
    await waitJob(cancelId, ["running"]); await team("/cancel", { id: cancelId });
    const cancelled = await waitJob(cancelId, ["cancelled"]); assert.equal(cancelled.result, undefined);
    await team("/export?id=" + cancelId, undefined, 409);
    await team("/export?id=missing&userId=forged", undefined, 404);
    await team("/job?id=missing", undefined, 404);
    await team("/unknown", {}, 404);
  } finally { await h.stop(); }
});

test("进程中断后自动接续：复用已保存整理回执，不重做已完成角色", { timeout: 60000 }, async () => {
  const h = await startModelHarness();
  const post = async (path: string, body: unknown) => {
    const r = await fetch(h.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json() as any; assert.ok(r.ok, JSON.stringify(data)); return data;
  };
  const read = async (id: string) => (await (await fetch(h.base + "/api/assistant-team/job?id=" + id)).json() as any).job;
  try {
    await post("/api/llm-config", { provider: "custom", protocol: "openai-compatible", baseUrl: h.modelBase + "/v1", model: "manual", selectionMode: "manual" });
    h.state.replyFor = (body) => {
      const system = body.messages[0].content;
      if (system.includes("提取带来源的事实")) { h.state.delayMs = 3000; return "已保存的整理回执 S1"; }
      return system.includes("最终交付协议") ? '{"summary":"重启后自动交付","fields":[]}' : "核验回执 S1";
    };
    const { record } = await post("/api/assistant-team/start", { requestId: "restart-in-flight", objective: "QA-RESTART", materials: "[S1] 合成材料", workerIds: ["bot-organizer"], reviewerId: "bot-reviewer" });
    let interrupted = false;
    for (let i = 0; i < 200; i++) {
      const job = await read(record.id);
      if (job.checkpoints.some((c: any) => c.data?.teamReceipt?.stageId === "work:bot-organizer" && c.data.teamReceipt.state === "returned")
        && job.checkpoints.some((c: any) => c.data?.teamReceipt?.stageId === "review:bot-reviewer" && c.data.teamReceipt.state === "received")) { interrupted = true; break; }
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(interrupted); h.state.delayMs = 0;
    await h.restart();
    let result: any;
    for (let i = 0; i < 200; i++) {
      result = await read(record.id); if (["succeeded", "failed"].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(result.result.summary, "重启后自动交付");
    const organizerCalls = h.requests.filter((r) => String(r.body?.messages?.[0]?.content).includes("提取带来源的事实"));
    assert.equal(organizerCalls.length, 1);
    assert.equal(result.result.data.receipts.length, 3);
  } finally { await h.stop(); }
});
