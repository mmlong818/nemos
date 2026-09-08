import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OPEN_QUESTION_LIMITS,
  openQuestionsPrompt,
  parseOpenQuestions,
  skipsOpenQuestions,
} from "../../examples/companion/deliverable-alignment.js";
import { CapabilityRuntime } from "../../examples/companion/capabilities.js";

const item = { question: "材料没说清预算口径", assumed: "按含税总额计算", affects: "费用小节的所有数字" };

test("正常解析：最多三条，每条三个字段齐全", () => {
  const parsed = parseOpenQuestions(JSON.stringify([item, item, item, item]));
  assert.equal(parsed.length, OPEN_QUESTION_LIMITS.maxItems);
  assert.deepEqual(parsed[0], item);
  assert.deepEqual(parseOpenQuestions(JSON.stringify({ questions: [item] })), [item]);
});

// 只说"有个判断没把握"而不说当前采用了什么，用户无法据此行动——所以整条丢弃而不是补空串。
test("缺字段的条目被丢弃，不补空串", () => {
  const parsed = parseOpenQuestions(JSON.stringify([
    { question: "有", assumed: "有", affects: "" },
    { question: "有", assumed: "", affects: "有" },
    { assumed: "有", affects: "有" },
    item,
  ]));
  assert.deepEqual(parsed, [item]);
});

test("单字段超长时截断，空白折叠", () => {
  const parsed = parseOpenQuestions(JSON.stringify([{
    question: "问".repeat(400),
    assumed: "做法\n\n  换行与多空格",
    affects: "影响",
  }]));
  assert.equal(parsed[0]!.question.length, OPEN_QUESTION_LIMITS.maxFieldLength);
  assert.equal(parsed[0]!.assumed, "做法 换行与多空格");
});

// 拿不到待确认判断只该少一段附注，不该让已经做完的交付物失败。
test("任何异常输入都返回空数组，不抛", () => {
  for (const raw of ["", "   ", "没有 JSON 的一段话", "{坏 JSON", "[1,2,3]", "null", "[]", '{"questions":"不是数组"}']) {
    assert.deepEqual(parseOpenQuestions(raw), [], `应当返回空数组：${raw}`);
  }
  assert.deepEqual(parseOpenQuestions(undefined as unknown as string), []);
});

test("容忍代码围栏与前后多余文字", () => {
  assert.deepEqual(parseOpenQuestions("```json\n" + JSON.stringify([item]) + "\n```"), [item]);
  assert.deepEqual(parseOpenQuestions("这是结果：\n" + JSON.stringify([item]) + "\n以上。"), [item]);
});

test("纯转换类能力跳过追问，且名单里每个 id 都真实存在", () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-skip-ids-"));
  try {
    const ids = new Set(runtimeAt(dir, async () => ({ reply: "", facts: [] })).listAbilities().map((a) => a.id));
    // 写进跳过名单却不存在的 id 是一条永远命中不到的死规则——和给不存在的抛出点
    // 注册失败编号是同一类错误。
    for (const id of ["article-polish", "document-conversion", "ocr-extraction", "image-prompt-reconstruction"]) {
      assert.equal(skipsOpenQuestions(id), true, id);
      assert.ok(ids.has(id), `跳过名单里的 ${id} 不是真实能力`);
    }
    for (const id of ["research-brief", "document-draft", "html-report", "decision-brief"]) {
      assert.equal(skipsOpenQuestions(id), false, id);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("追问提示明确禁止凑数，并截断过长交付物", () => {
  const prompt = openQuestionsPrompt({ capabilityName: "文档稿", title: "季度总结", deliverable: "正" .repeat(20_000) });
  assert.match(prompt, /确实没有就返回空数组/);
  assert.match(prompt, /不要为了凑数编造/);
  assert.match(prompt, /只输出 JSON/);
  // 已写明「未知」的地方不该再重复列一次。
  assert.match(prompt, /已经写明「未知」/);
  assert.ok(prompt.length < OPEN_QUESTION_LIMITS.maxDeliverableChars + 1_000, "交付物应当被截断");
});

function runtimeAt(dir: string, notify: (personaId: string, text: string, ...rest: unknown[]) => Promise<{ reply: string; facts: string[] }>) {
  return new CapabilityRuntime({
    dataDir: dir,
    personas: () => [{ id: "clownfish", name: "小丑鱼" }],
    notify: notify as never,
  });
}

function task(runtime: CapabilityRuntime, capabilityId = "document-draft") {
  return runtime.createTask({
    title: "季度总结", personaId: "clownfish", capabilityId,
    instruction: "整理材料并交付", format: "md", enabled: true, schedule: { mode: "manual" },
  });
}

test("追问结果进产物元数据，且不污染交付物正文", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-open-questions-"));
  try {
    const prompts: string[] = [];
    const runtime = runtimeAt(dir, async (_persona, text) => {
      prompts.push(text);
      // 第一次是交付物，第二次是追问。
      return { reply: prompts.length === 1 ? "正文内容\n交付完成。" : JSON.stringify([item]), facts: [] };
    });
    const created = task(runtime);
    const notification = await runtime.runTask(created.id, {} as never);

    assert.equal(prompts.length, 2, "应当在交付物之后单独追问一次");
    assert.match(prompts[1]!, /最没把握的判断/);
    assert.deepEqual(notification.artifact.metadata?.openQuestions, [item]);
    // 追问的回复不该进交付物文件。
    const body = readFileSync(notification.artifact.file, "utf8");
    assert.doesNotMatch(body, /assumed/);
    assert.match(body, /正文内容/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("追问失败不影响交付物：任务照常完成，只是没有这一项", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-open-questions-fail-"));
  try {
    let calls = 0;
    const runtime = runtimeAt(dir, async () => {
      calls += 1;
      if (calls === 2) throw new Error("追问调用失败");
      return { reply: "正文内容\n交付完成。", facts: [] };
    });
    const created = task(runtime);
    const notification = await runtime.runTask(created.id, {} as never);
    assert.equal(calls, 2);
    assert.equal(notification.artifact.metadata?.openQuestions, undefined);
    assert.ok(notification.artifact.id, "交付物仍然生成");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("跳过类能力不产生第二次模型调用", async () => {
  const dir = mkdtempSync(join(tmpdir(), "clownfish-open-questions-skip-"));
  try {
    let calls = 0;
    const runtime = runtimeAt(dir, async () => { calls += 1; return { reply: "润色后正文\n交付完成。", facts: [] }; });
    const created = task(runtime, "article-polish");
    await runtime.runTask(created.id, {} as never);
    assert.equal(calls, 1, "纯转换类能力不该为追问多花一次调用");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
